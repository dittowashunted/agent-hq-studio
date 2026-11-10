# Runs on every launch (from "Agent HQ.bat"): update the app copy to the newest origin/<branch>. Quick, safe offline.
# -Branch <name> moves the app copy to another branch for good (updates Agent-HQ-App.json).
param(
  [string]$AppDir = (Split-Path -Parent $PSScriptRoot),
  [string]$ConfigFile = (Join-Path $env:USERPROFILE 'Documents\Agent-HQ-App.json'),
  [string]$Branch,
  [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
function Step([string]$text, [scriptblock]$act) { if ($WhatIf) { "[WhatIf] $text" } else { & $act } }
function G { $o = & git -C $AppDir @args 2>&1; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' '): $o" }; $o }

try {
  # Only the app copy (<ConfigFile without .json>) is ever updated, never a dev worktree.
  $appCopy = Join-Path (Split-Path -Parent $ConfigFile) ([IO.Path]::GetFileNameWithoutExtension($ConfigFile))
  if (([IO.Path]::GetFullPath($AppDir)).TrimEnd([char]92, [char]47) -ne ([IO.Path]::GetFullPath($appCopy)).TrimEnd([char]92, [char]47)) { return }
  if (-not (Test-Path -LiteralPath $ConfigFile)) { 'Update skipped: no branch config (run agent-hq-switch.ps1 first).'; return }
  $cfg = Get-Content -Raw -LiteralPath $ConfigFile | ConvertFrom-Json
  $b = if ($Branch) { $Branch } else { $cfg.branch }
  # Fetch needs the network and can hang, so give it 20 s.
  $job = Start-Job { param($d, $br) & git -C $d fetch --quiet origin $br 2>&1 | Out-Null; $LASTEXITCODE } -ArgumentList $AppDir, $b
  if (-not (Wait-Job $job -Timeout 20)) { Stop-Job $job; Remove-Job $job -Force; 'Offline or slow: staying on the current version.'; return }
  $res = @(Receive-Job $job); Remove-Job $job
  if ($res[-1] -ne 0) { "Could not reach origin ($b): staying on the current version."; return }

  # The branch is only saved once origin really has it.
  if ($Branch -and $Branch -ne $cfg.branch) { Step "set branch to $Branch in $ConfigFile" { @{ branch = $Branch } | ConvertTo-Json | Set-Content -LiteralPath $ConfigFile -Encoding utf8 } }
  $head = (G rev-parse HEAD).Trim()
  $new = (G rev-parse "origin/$b").Trim()
  if ($head -eq $new) { "Agent HQ is up to date ($($new.Substring(0,7)))."; return }
  # Agent work (games, assets, memory) stays in the app copy. Git carries it across the checkout and
  # refuses only when the update would overwrite one of those changed files; then stay on this version.
  try { Step "checkout --detach origin/$b ($($head.Substring(0,7)) to $($new.Substring(0,7)))" { G checkout --quiet --detach "origin/$b" | Out-Null } }
  catch { 'The update would overwrite local work in the app copy: staying on the current version.'; return }
  # Stop only this copy's server; keepalive.mjs (or the next launch) restarts it on the new code.
  $key = ([IO.Path]::GetFullPath($AppDir)).TrimEnd('\', '/').ToLowerInvariant().Replace('\', '/')
  $mine = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $c = ([string]$_.CommandLine).ToLowerInvariant().Replace('\', '/'); $c.Contains($key) -and $c.Contains('server.mjs') })
  foreach ($p in $mine) { Step "stop HQ server $($p.ProcessId) so it restarts on the new code" { Stop-Process -Id $p.ProcessId -Force } }
  if ($WhatIf) { '[WhatIf] done.'; return }
  "Updated Agent HQ to $($new.Substring(0,7))."
} catch { "Update failed ($($_.Exception.Message.Split("`n")[0])): staying on the current version." }
