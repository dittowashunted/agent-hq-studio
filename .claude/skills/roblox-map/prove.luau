--!nocheck
-- Reachability proof by raycasts, not PathfindingService. Studio MCP execute_luau, EDIT mode only, never Play.
-- Set SPAWN_NAME and FOLDER_PATH, run, read the PROVE lines. Changes nothing in the place.
local SPAWN_NAME = "SpawnLocation" -- a BasePart or SpawnLocation anywhere under Workspace
local FOLDER_PATH = { "Map" } -- path of the folder holding the platforms, from Workspace
local WALK_SPEED = 16 -- fallback when StarterPlayer.CharacterWalkSpeed is 0
local SAFETY = 0.85 -- use 85% of the theoretical jump so players are not frame-perfect
local STEP_HEIGHT = 1.5 -- assumed auto-step; unverified, measure it in your place
local GRID = 4 -- studs between sample points on a top surface

local ws = game:GetService("Workspace")
local sp = game:GetService("StarterPlayer")
local g = ws.Gravity
local jumpH = sp.CharacterUseJumpPower and (sp.CharacterJumpPower ^ 2) / (2 * g) or sp.CharacterJumpHeight
local walk = sp.CharacterWalkSpeed > 0 and sp.CharacterWalkSpeed or WALK_SPEED
local minUp = math.cos(math.rad(sp.CharacterMaxSlopeAngle))
local rawJump = jumpH
jumpH *= SAFETY

local folder = ws
for _, n in ipairs(FOLDER_PATH) do
	folder = folder:FindFirstChild(n) or error("missing " .. n)
end
local spawn = ws:FindFirstChild(SPAWN_NAME, true) or error("spawn not found")
local params = RaycastParams.new()

-- standable top sample points of a part: ray down from above, keep hits on this part that are flat enough
local function tops(part)
	local pts = {}
	local sx, sz = part.Size.X, part.Size.Z
	local topY = part.Position.Y + part.Size.Y / 2 + 50
	for x = -sx / 2, sx / 2, GRID do
		for z = -sz / 2, sz / 2, GRID do
			local o = part.CFrame:PointToWorldSpace(Vector3.new(x, 0, z))
			local r = ws:Raycast(Vector3.new(o.X, topY, o.Z), Vector3.new(0, -200, 0), params)
			if r and r.Instance == part and r.Normal.Y >= minUp then
				table.insert(pts, r.Position)
			end
		end
	end
	return pts
end

-- can a character go from a to b? gap is horizontal, dy is rise (negative = drop)
local function canCross(a, b)
	local gap = Vector3.new(a.X - b.X, 0, a.Z - b.Z).Magnitude
	local dy = b.Y - a.Y
	if gap < 0.5 and dy <= STEP_HEIGHT then
		return true
	end
	if dy > jumpH then
		return false
	end
	local tUp = math.sqrt(2 * jumpH / g)
	local tDown = math.sqrt(2 * math.max(jumpH - dy, 0) / g)
	if gap > walk * (tUp + tDown) * SAFETY then
		return false
	end
	-- line of sight at knee height: a wall between the two edges blocks the hop
	local from, to = a + Vector3.new(0, 3, 0), b + Vector3.new(0, 3, 0)
	return ws:Raycast(from, to - from, params) == nil
end

local nodes, samples = {}, {}
for _, d in ipairs(folder:GetDescendants()) do
	if d:IsA("BasePart") and d.CanCollide then
		local p = tops(d)
		if #p > 0 then
			table.insert(nodes, d)
			samples[d] = p
		end
	end
end
local startPts = tops(spawn)
if #startPts == 0 then
	startPts = { spawn.Position + Vector3.new(0, spawn.Size.Y / 2, 0) }
end
samples[spawn] = startPts
if not table.find(nodes, spawn) then
	table.insert(nodes, spawn)
end

local function linked(a, b)
	for _, pa in ipairs(samples[a]) do
		for _, pb in ipairs(samples[b]) do
			if canCross(pa, pb) then
				return true
			end
		end
	end
	return false
end

-- ponytail: O(n^2 * samples^2); fine for a few hundred parts, bucket by region for thousands
local reached, queue = { [spawn] = true }, { spawn }
while #queue > 0 do
	local cur = table.remove(queue, 1)
	for _, n in ipairs(nodes) do
		if not reached[n] and linked(cur, n) then
			reached[n] = true
			table.insert(queue, n)
		end
	end
end

local ok, bad = 0, {}
for _, n in ipairs(nodes) do
	if n ~= spawn then
		if reached[n] then
			ok += 1
		else
			table.insert(bad, n:GetFullName())
		end
	end
end
print(
	("PROVE jumpHeight=%.1f gravity=%.1f walk=%d maxSlope=%d"):format(
		rawJump,
		g,
		walk,
		sp.CharacterMaxSlopeAngle
	)
)
print(("PROVE placed=%d reachable=%d failed=%d"):format(#nodes - 1, ok, #bad))
for _, name in ipairs(bad) do
	print("PROVE FAILED " .. name)
end
