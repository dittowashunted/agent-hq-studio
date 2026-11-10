"""Push src/ into the open Studio place (Edit mode) through the Studio MCP. A tiny one-way Rojo.

Usage: python scripts/sync_studio.py <studio_id>
Rebuilds the three roots from default.project.json (Shared, Server, Client) from scratch, so
renames and deletes are handled. Play mode must be stopped.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def roots():
    tree = json.load(open(os.path.join(ROOT, "default.project.json"), encoding="utf-8"))["tree"]
    out = []

    def walk(node, path):
        for key, child in node.items():
            if key.startswith("$") or not isinstance(child, dict):
                continue
            if "$path" in child:
                out.append((path, key, child["$path"]))
            else:
                walk(child, path + [key])

    walk(tree, [])
    return out


def long_string(text: str) -> str:
    level = 0
    while ("]" + "=" * level + "]") in text:
        level += 1
    eq = "=" * level
    return f"[{eq}[\n{text}]{eq}]"  # Luau drops the first newline after [[


def emit(lines, parent_var, folder):
    for name in sorted(os.listdir(folder)):
        full = os.path.join(folder, name)
        if os.path.isdir(full):
            var = f"f{len(lines)}"
            lines.append(f'local {var} = Instance.new("Folder"); {var}.Name = {json.dumps(name)}; {var}.Parent = {parent_var}')
            emit(lines, var, full)
            continue
        if not name.endswith(".luau"):
            continue
        base = name[: -len(".luau")]
        cls = "ModuleScript"
        if base.endswith(".server"):
            cls, base = "Script", base[: -len(".server")]
        elif base.endswith(".client"):
            cls, base = "LocalScript", base[: -len(".client")]
        src = open(full, encoding="utf-8").read()
        var = f"s{len(lines)}"
        lines.append(
            f'local {var} = Instance.new("{cls}"); {var}.Name = {json.dumps(base)}; '
            f"{var}.Source = {long_string(src)}; {var}.Parent = {parent_var}"
        )


def main() -> int:
    lines = ["local function at(path) local n = game for _, k in path do n = n:FindFirstChild(k) or game:GetService(k) end return n end"]
    for parent, name, path in roots():
        var = f"r{len(lines)}"
        lines.append(f"local {var}p = at({json.dumps(parent).replace('[', '{').replace(']', '}')})")
        lines.append(f"if {var}p:FindFirstChild({json.dumps(name)}) then {var}p[{json.dumps(name)}]:Destroy() end")
        lines.append(f'local {var} = Instance.new("Folder"); {var}.Name = {json.dumps(name)}; {var}.Parent = {var}p')
        emit(lines, var, os.path.join(ROOT, path))
    lines.append('return "synced"')
    probe = os.path.join(ROOT, "captures", "_sync.luau")
    os.makedirs(os.path.dirname(probe), exist_ok=True)
    open(probe, "w", encoding="utf-8").write("\n".join(lines))
    client = os.path.join(ROOT, "scripts", "studio_mcp.py")
    return subprocess.call([sys.executable, client, "luau", sys.argv[1], "Edit", probe])


if __name__ == "__main__":
    sys.exit(main())
