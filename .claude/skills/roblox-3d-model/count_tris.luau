--!nocheck
-- Studio MCP execute_luau, Edit mode. Select a Model or Folder first. Prints counts, changes nothing.
local Selection = game:GetService("Selection")
local sel = Selection:Get()[1]
if not sel then
	error("select a Model or Folder first")
end
local parts, meshes, tris, unique = 0, 0, 0, {}
for _, d in ipairs(sel:GetDescendants()) do
	if d:IsA("BasePart") then
		parts += 1
		if d:IsA("MeshPart") then
			meshes += 1
			unique[d.MeshId .. "|" .. (d:FindFirstChildOfClass("SurfaceAppearance") and "pbr" or d.TextureID)] = true
			-- ponytail: triangle count is not exposed to Luau everywhere; read it in Studio's import dialog or decimate.py report
			local ok, n = pcall(function() return (d :: any):GetTriangleCount() end)
			if ok and type(n) == "number" then tris += n end
		end
	end
end
local u = 0
for _ in pairs(unique) do u += 1 end
print(("%s: parts=%d meshparts=%d unique mesh+material=%d triangles=%s"):format(
	sel.Name, parts, meshes, u, tris > 0 and tostring(tris) or "n/a (use decimate.py report)"))
