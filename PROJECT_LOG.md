# VFX AI — Project Log

## Goal
Transform the existing Roblox AI Bridge into an AI-assisted VFX authoring tool for Roblox Studio. The target workflow is natural-language requests that create and refine effects directly in Studio edit mode, with honest progress reporting, visual evaluation where supported, safe undo/recovery, and no requirement to press Play just to author an effect.

## Working principles
- Preserve the existing `main` branch; all VFX work happens on `vfx-specialization`.
- Inspect before rewriting. Reuse infrastructure only when it is demonstrably useful.
- Do not claim a feature works until it has been tested in Roblox Studio.
- Separate structural success (instances/properties) from visual quality.
- Keep API credentials out of source control; use local environment configuration.
- Prefer small, reversible changes and record test results here.

## Baseline from repository review
- The `ia-v2/ia/server.js` flow is primarily programmed around Roblox/Luau coding tasks and structured actions.
- `ia-v2/ia/omniRoute.js` routes model requests through a local OpenAI-compatible endpoint configured by environment variables.
- `ia-v2/ia/RobloxAIBridgePlugin.lua` can inspect project objects and apply supported instance/property actions in Studio edit mode.
- The plugin's current allowed-property handling and action schema need review before complex VFX properties can be set reliably.
- No implementation was found in the reviewed plugin for visual screenshot capture; this remains unverified across the whole project.
- The current bridge is a useful starting point, not yet a VFX authoring/evaluation system.

## First milestone
Create a single blue energy-orb effect directly in Studio edit mode, with an organized hierarchy and configurable layers. Verify that:
1. The plugin can create the needed instances and typed properties.
2. The effect is visible in the Studio viewport without entering Play mode.
3. The user can undo the changes safely.
4. We can capture or otherwise evaluate the appearance, then apply at least one correction.
5. Logs distinguish successful operations, rejected actions, and visual checks that have not been performed.

## Planned work
1. Audit repository structure, current request/response protocol, and plugin action validation.
2. Define a VFX-specific design representation (effect goal, layers, attachment points, timing, materials, colors, textures, animation, and quality checks).
3. Extend the bridge safely for VFX instance classes and typed Roblox properties/sequences, with limits and validation.
4. Build the smallest test effect in edit mode.
5. Investigate and implement an authorized Studio visual-capture/evaluation loop where supported.
6. Add progress reporting, rollback boundaries, test notes, and usage/cost logging.
7. Only after the first milestone passes, expand to beams, projectiles, impacts, and multi-phase effects.

## Status
- [x] Created isolated branch `vfx-specialization` from `main`.
- [x] Initial repository review completed.
- [x] Initial audit of the request/response protocol and plugin action path completed; further testing is still required.
- [ ] Run Node syntax checks and validate the OmniRoute response-to-plugin action path.
- [ ] Run Node syntax checks and validate the OmniRoute response-to-plugin action path.
- [ ] Build and test the first edit-mode energy-orb effect in Roblox Studio.
- [ ] Verify visual capture and correction workflow.


## Changes made on `vfx-specialization`
- Replaced the server's programmer-focused system prompt with VFX authoring instructions: design intent, layer purpose, edit-mode workflow, truthful reporting, and strict JSON actions.
- Added VFX-specific OmniRoute enrichment so the model receives instance-action rules and real project-object context.
- Added a server-side allowlist that rejects script/remotes/game-test actions and accepts only visual instance/property actions; deletion is accepted only when the user explicitly asks to remove something.
- Changed the request mode and health capability list to describe direct VFX authoring rather than general coding.
- Added VFX-specific OmniRoute enrichment so the model receives instance-action rules and real project-object context.
- Added a server-side allowlist that rejects script/remotes/game-test actions and accepts only visual instance/property actions; deletion is accepted only when the user explicitly asks to remove something.
- Changed the request-mode text and health capability list to describe direct VFX authoring rather than general coding.
- Routed all former programmer-prompt references through the VFX prompt.
- Extended the Studio bridge's typed property conversion to support `NumberRange`, `NumberSequence`, and `ColorSequence`, alongside existing vector/color/CFrame/UDim2/Enum types.
- Added validation for sequence keypoint ordering, minimum keypoint count, and endpoints at times 0 and 1.
- Wrapped typed conversion and property assignment together so malformed values are rejected as a logged action failure rather than escaping the property setter.
- These changes have **not yet been run in Roblox Studio**. Syntax, model output compatibility, visual appearance, and Studio permissions remain unverified.
