-- Client-run probe: draws every icon at 48 px on a dark and a light swatch, name underneath.
-- Run with execute_luau in Client context during play, then screen_capture.
local Players = game:GetService("Players")

local ui = Players.LocalPlayer:WaitForChild("PlayerScripts"):WaitForChild("Client"):WaitForChild("UI")
local Icons = require(ui:WaitForChild("Icons"))
local Theme = require(ui:WaitForChild("Theme"))

local old = Players.LocalPlayer.PlayerGui:FindFirstChild("IconProbe")
if old then
	old:Destroy()
end

local gui = Instance.new("ScreenGui")
gui.Name = "IconProbe"
gui.DisplayOrder = 200
gui.ResetOnSpawn = false
gui.Parent = Players.LocalPlayer.PlayerGui

local bg = Instance.new("Frame")
bg.Size = UDim2.fromScale(1, 1)
bg.BackgroundColor3 = Theme.navy
bg.Parent = gui

local grid = Instance.new("UIGridLayout")
grid.CellSize = UDim2.fromOffset(150, 96)
grid.CellPadding = UDim2.fromOffset(6, 6)
grid.Parent = bg

local names = Icons.names()
for _, name in names do
	local cell = Instance.new("Frame")
	cell.BackgroundTransparency = 1
	cell.Parent = bg

	local dark = Instance.new("Frame")
	dark.Size = UDim2.fromOffset(68, 60)
	dark.BackgroundColor3 = Theme.navyCard
	dark.Parent = cell
	local ic = Icons.make(name, 48, Theme.white)
	ic.Position = UDim2.fromOffset(10, 6)
	ic.Parent = dark

	local light = Instance.new("Frame")
	light.Position = UDim2.fromOffset(74, 0)
	light.Size = UDim2.fromOffset(68, 60)
	light.BackgroundColor3 = Theme.soft
	light.Parent = cell
	local ic2 = Icons.make(name, 48, Theme.ink)
	ic2.Position = UDim2.fromOffset(10, 6)
	ic2.Parent = light

	local label = Instance.new("TextLabel")
	label.Position = UDim2.fromOffset(0, 64)
	label.Size = UDim2.fromOffset(150, 20)
	label.BackgroundTransparency = 1
	label.Text = name
	label.TextColor3 = Theme.white
	label.TextSize = 16
	label.FontFace = Theme.bold
	label.Parent = cell
end

return "icons drawn: " .. #names
