---
name: roblox-animation
description: Use for Roblox rigs, animation and ragdolls: Avatar Joint Upgrade and the Motor6D to AnimationConstraint migration, BallSocketConstraint ragdolls, IKControl foot placement, Animation Graphs and state machines, Adaptive Animation, root motion, walk-cycle timing, exporting animation from Blender, animation capture, and camera field-of-view only where it touches animation. Research notes with sources and an unverified list.
---

# roblox-animation

Research done 2026-11-04: local Creator Docs first (`knowledge.mjs`, `characters/`, `animation/`, `physics/constraints/`), then the web. Anything not confirmed is marked UNVERIFIED. Re-check dates before relying on them: Roblox changes this area often.

## 1. Rigs and Avatar Joint Upgrade (AJU)
- `StarterPlayer.AvatarJointUpgrade` replaces `Motor6D` joints on R15 characters with `AnimationConstraint` (animation) plus `BallSocketConstraint` (limb limits). Avatar AnimationConstraints start with `IsKinematic = true`, so animation behaves like before. (Creator Docs "Characters"; DevForum announcement, 26 Jan 2026.)
- Migration, per the announcement: phase 1 is opt-in (new experiences default Disabled at the time of the post); phase 2 flips the default to Enabled, targeted H2 2026, and is breaking for Motor6D-dependent games (can be set back to Disabled for now); phase 3 removes the property, no date. Confirm the current phase in Studio before planning.
- Script fixes: `IsA("Motor6D")` will not find the new joints (look for `AnimationConstraint`, or support both); setting `C0`, `C1`, `Part0`, `Part1` errors, use Attachments; do not edit `RigAttachment` CFrames to fake tilts. R6 is not upgraded; existing NPCs are not upgraded.
- Props held in hand (swords, guns) that were welded with Motor6D need their own plan: UNVERIFIED, no clear official answer found.

## 2. AnimationConstraint and BallSocketConstraint
- AnimationConstraint aligns two attachments to a `Transform`. Kinematic = snaps exactly, no physics. Non-kinematic = follows the target with force and torque capped by `MaxForce` and `MaxTorque` (Creator Docs, "AnimationConstraint").
- Mixed kinematic and physics joints can make replication choppy for other players, mostly when the torso moves (DevForum).

## 3. Ragdoll set-up and tuning
- Official route with AJU: weaken or disable AnimationConstraints so the BallSocketConstraints take over; set `IsKinematic = false` for physics-driven joints; turn off break-joints-on-death for an instant ragdoll. See the Physically Simulated Characters demo (DevForum).
- Tuning checklist (community advice, partly UNVERIFIED): `LimitsEnabled` and `TwistLimitsEnabled` on, sensible `UpperAngle` and `TwistLowerAngle/TwistUpperAngle` per joint (elbows and knees tight, shoulders and hips wide); raise `MaxFrictionTorque` to stop jitter; consider `Massless` limbs; add no-collision between neighbouring limbs; recover by re-enabling the AnimationConstraints rather than destroying joints; hips "thrusting" while ragdolling while running is a known bug report with no canonical fix.
- NPCs: the NPC Kit has a Ragdoll module (Creator Docs "NPC kit"). Cap ragdolls alive at once for performance (Creator Docs "Improve performance").

## 4. IKControl and foot placement
- `IKControl` needs `Type`, `EndEffector`, `Target` and `ChainRoot`; add joint constraints (elbow hinge, wrist limits) or poses look broken (Creator Docs "Inverse kinematics"). It works on a Humanoid or AnimationController.
- Foot placement pattern (DevForum prototype, 2023, older): one IKControl per leg; raycast from the hip through the foot to find the ground; offset so the sole, not the ankle, touches the ground; update after the animation step and before the IK solve. There is an IKControl leg type that estimates planted feet: confirm the current enum in the reference before using it.
- Do not run it for every NPC in view; limit by distance.

## 5. Animation Graphs, state machines, Adaptive Animation
- Animation Graph Editor: node graph that mixes clips (blend nodes, state machines) with parameters. Drive it with `AnimationTrack:SetParameter`. Replication depends on the authority mode: in Automatic mode parameters replicate; for a player in Server mode set them on both server and client; NPCs set them on the server (Creator Docs "Graph editor"). The Studio-generated Animate script has a commented `SetParameter` block as a starting point.
- State machines (Idle, Walk, Run, Jump, Fall, LandIdle) transition on conditions; hold clips such as Fall and Landing with Once-and-hold; `Grounded` boolean example in the docs ("Graph Editor state machines").
- Adaptive Animation: `HumanoidRigDescription` and `DigitsRigDescription` map any custom rig onto the 15 standard joints (more optional) so one animation library plays on different bodies. Set the rig type to Custom on import and fix the T-pose.

## 6. Root motion
- No built-in root motion feature was found (DevForum 2022 thread, UNVERIFIED for 2026). Common workaround: animate in place and move the character from script, or copy a helper rig's root transform to the `HumanoidRootPart` each frame. A "RootMotion module" from the owner's list could not be matched to an official source: UNVERIFIED, ask the owner for the link.

## 7. Walk cycle and weight shift (craft notes, not Roblox facts)
- Stride length must match walk speed or feet slide: speed = stride per cycle / cycle time. Check 16 studs per second against the clip length.
- Contact, down, passing, up, in two steps per cycle. The body drops after contact and rises at passing; the pelvis shifts over the planted leg; the shoulders counter-rotate to the hips; keep the head steadier than the torso.
- Idle and run need a matching foot phase so the blend does not scissor legs; loop clips end on their first pose.

## 8. Export from Blender or Maya
- Animations must be in place with a hierarchy and names compatible with Studio, frozen transforms (scale 1, rotation 0), baked animation, FBX (Creator Docs "Export avatar animations from Maya"; "Modeling specifications"). Blender steps are the same in spirit: apply transforms, bake, export FBX with baked animation; the exact Blender menu path is UNVERIFIED here.
- Import via the 3D Importer or Animation Editor "From FBX animation", then test in Studio before publishing.

## 9. Animation capture
- Face capture (webcam, up to 60 s, needs an animation-compatible head) and body capture (upload an `.mp4` or `.mov`: one person, well lit, one continuous shot under 15 seconds, steady camera) in the Animation Editor; both are beta toggles in the docs I read. Always clean up the keyframes after.

## 10. Camera items that touch animation
- `Camera.FieldOfView` is 1 to 120 degrees, default 70, measured along the direction set by `Camera.FieldOfViewMode`. Wider FOV exaggerates run speed; ease it with the animation, not instantly. Post-processing effects, lighting under streaming and a Blender camera add-on from the owner's list: no animation-specific source confirmed, UNVERIFIED.

## Rules of use
- Edit mode in Studio MCP, private test place, never publish. Animations are uploaded by the owner.
- Report which doc or post each choice came from and its date.

## Sources
- Roblox Creator Docs: "Characters", "Adaptive Animation", "AnimationConstraint", "Inverse kinematics", "Animation Graph Editor", "Graph Editor state machines", "Animation capture", "Export avatar animations from Maya", "NPC kit", "Camera".
- DevForum: "[Studio Beta] Avatar Joint Upgrade: Enabling Physically-Simulated Characters" https://devforum.roblox.com/t/studio-beta-avatar-joint-upgrade-enabling-physically-simulated-characters/3266099
- DevForum: "Avatar Joint Upgrade for physically simulated character movement is now live" https://devforum.roblox.com/t/avatar-joint-upgrade-for-physically-simulated-character-movement-is-now-live/4298561
- DevForum: "Prototype R15 Animation IKControl Footplant" https://devforum.roblox.com/t/prototype-r15-animation-ikcontrol-footplant/2187090
- DevForum: "Help with Root Motion (animating the HumanoidRootPart)" https://devforum.roblox.com/t/help-with-root-motion-animating-the-humanoidrootpart/1556616
- DevForum: "BallSocketConstraint arms cause the player to wiggle and move" https://devforum.roblox.com/t/ballsocketconstraint-arms-cause-the-player-to-wiggle-and-move/1904174
