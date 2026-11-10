local cam = workspace.CurrentCamera
local gui = game.Players.LocalPlayer.PlayerGui
local box = gui.Hud.Canvas.Modals:FindFirstChild("create")
local out = { "viewport " .. tostring(cam.ViewportSize) }
if box then
	for _, d in box:GetDescendants() do
		if d:IsA("TextBox") then table.insert(out, "textbox at " .. tostring(d.AbsolutePosition) .. " size " .. tostring(d.AbsoluteSize) .. " text=" .. d.Text) end
	end
end
return table.concat(out, "\n")
