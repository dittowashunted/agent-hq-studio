--!strict
-- Undoes scripts/probes/thumbnail.luau: restores the saved Lighting values and removes the scene.
local Lighting = game:GetService("Lighting")
local scene = workspace:FindFirstChild("ThumbnailScene")
if not scene then
	return "no scene"
end
if scene:GetAttribute("ClockTime") ~= nil then
	Lighting.ClockTime = scene:GetAttribute("ClockTime")
	Lighting.Brightness = scene:GetAttribute("Brightness")
	Lighting.Ambient = scene:GetAttribute("Ambient")
	Lighting.OutdoorAmbient = scene:GetAttribute("OutdoorAmbient")
	local atmo = Lighting:FindFirstChildOfClass("Atmosphere")
	if atmo and not scene:GetAttribute("HadAtmosphere") then
		atmo:Destroy()
	end
end
scene:Destroy()
return "restored"
