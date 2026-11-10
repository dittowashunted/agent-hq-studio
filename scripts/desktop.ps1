# Desktop helper for studying a game running in the Roblox client (owner-authorized, no purchases).
#   desktop.ps1 shot <out.png>            full-screen screenshot
#   desktop.ps1 windows                   list visible windows
#   desktop.ps1 focus <titlePart>         bring a window to the front
#   desktop.ps1 click <x> <y>             left click at screen coords
#   desktop.ps1 scroll <x> <y> <ticks>    mouse wheel (negative = down)
#   desktop.ps1 key <keys>                SendKeys string, e.g. "{ESC}" or "e"
param([string]$cmd, [string]$a, [string]$b, [string]$c)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, int d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[W]::SetProcessDPIAware() | Out-Null
switch ($cmd) {
  "shot" {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save($a, [System.Drawing.Imaging.ImageFormat]::Png)
    "saved $a ($($bounds.Width)x$($bounds.Height))"
  }
  "windows" { Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize | Out-String -Width 200 }
  "focus" {
    $p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$a*" } | Select-Object -First 1
    if ($p) { [W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; "focused $($p.MainWindowTitle)" } else { "no window matching $a" }
  }
  "click" {
    # Roblox must be in front, and needs real mouse-move events to register hover before a click.
    $rb = Get-Process RobloxPlayerBeta -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($rb) { [W]::SetForegroundWindow($rb.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 250 }
    [W]::SetCursorPos([int]$a - 6, [int]$b - 6) | Out-Null; Start-Sleep -Milliseconds 80
    for ($i = 0; $i -lt 6; $i++) { [W]::mouse_event(0x0001, 1, 1, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 25 }
    Start-Sleep -Milliseconds 120
    [W]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 90
    [W]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); "clicked $a,$b"
  }
  "scroll" {
    [W]::SetCursorPos([int]$a, [int]$b) | Out-Null; Start-Sleep -Milliseconds 100
    [W]::mouse_event(0x0800, 0, 0, [int]$c * 120, [UIntPtr]::Zero); "scrolled $c at $a,$b"
  }
  "key" { [System.Windows.Forms.SendKeys]::SendWait($a); "sent $a" }
}
