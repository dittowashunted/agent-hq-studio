"""Click a visible GUI element by its text (or Name) in the running Studio play session.

Usage: python scripts/ui_click.py <studio_id> "<text>" [wait_ms]
Finds the smallest visible TextButton/TextLabel/TextBox whose Text (or Name) contains <text>,
then sends a real mouse click at its centre through the Studio MCP.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROBE = """
local q = %s
local best, bestArea = nil, math.huge
local function visible(g)
	while g and g:IsA("GuiObject") do
		if not g.Visible then return false end
		g = g.Parent
	end
	return g == nil or not g:IsA("ScreenGui") or g.Enabled
end
for _, d in game.Players.LocalPlayer.PlayerGui:GetDescendants() do
	if (d:IsA("TextButton") or d:IsA("TextLabel") or d:IsA("TextBox")) and (d.Text:find(q, 1, true) or d.Name == q or (d:IsA("TextBox") and d.PlaceholderText:find(q, 1, true))) and visible(d) then
		local area = d.AbsoluteSize.X * d.AbsoluteSize.Y
		if area > 0 and area < bestArea then best, bestArea = d, area end
	end
end
if not best then return "NOTFOUND" end
local c = best.AbsolutePosition + best.AbsoluteSize / 2
-- MCP mouse X is measured from the physical screen edge, but GUI X starts at the device safe area
-- (a phone notch shifts it 47 px on an iPhone 14). A full-bleed frame's X gives that offset; 0 on desktop.
local g = Instance.new("ScreenGui")
g.ScreenInsets = Enum.ScreenInsets.None
local f = Instance.new("Frame")
f.Size = UDim2.fromScale(1, 1)
f.Parent = g
g.Parent = game.Players.LocalPlayer.PlayerGui
task.wait()
local dx = -f.AbsolutePosition.X
g:Destroy()
return string.format("%%d,%%d", c.X + dx, c.Y)
"""


def run(args):
    return subprocess.run([sys.executable, os.path.join(HERE, "studio_mcp.py")] + args, capture_output=True, text=True, encoding="utf-8").stdout.strip()


def main():
    sid, text = sys.argv[1], sys.argv[2]
    wait = int(sys.argv[3]) if len(sys.argv) > 3 else 600
    probe = os.path.join(HERE, "..", "captures", "_find.luau")
    with open(probe, "w", encoding="utf-8") as f:
        f.write(PROBE % json.dumps(text))
    where = run(["luau", sid, "Client", probe])
    if "," not in where:
        print(f"NOT FOUND: {text}")
        return 1
    x, y = where.split(",")
    actions = [
        {"action": "moveTo", "x": int(x), "y": int(y)},
        {"action": "wait", "wait_time_ms": 120},
        {"action": "mouseButtonClick", "mouse_button": "left"},
        {"action": "wait", "wait_time_ms": wait},
    ]
    run(["call", "user_mouse_input", json.dumps({"studio_id": sid, "datamodel_type": "Client", "actions": actions})])
    print(f"clicked '{text}' at {x},{y}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
