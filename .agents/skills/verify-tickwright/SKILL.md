---
name: verify-tickwright
description: Launch and play Tickwright in two real browser clients; verify movement, shared building, the mob farm, Convex saves, and rendering evidence before reporting a feature works.
---

# Launch and doctor

Run `bun run setup`, `bun run doctor`, then `bun run dev`. Read `.local/ports.json`; wait for the client and room server ready lines. GET `http://127.0.0.1:<server>/health` must report `app: tickwright`, `storage: convex`, and `configured: true`.

Use T3 `preview_status`, then `preview_open` if needed. Open two distinct tabs on the same client URL and `?room=qa-<unique-suffix>`. Record each tab ID and pass it on every operation. A fresh room isolates edits from the user's island.

# Drive

Read a snapshot first. Fill `#player-name`, click `#join`, and wait for `#lobby` to be hidden. Confirm `#room-status` says `2/8` in both clients. Select toolbar buttons by accessible names, such as `Select Lamp`.

Keyboard controls: WASD, Space jump, Shift dash, F strike, Tab Sight, Q/E camera, C cutaway, [ and ] layer, 1–5 blocks. Left click breaks, right click places.

T3 `preview_press` presses one key briefly. To hold movement, use `preview_evaluate` to dispatch `KeyboardEvent('keydown', {code:'KeyD'})`, await a bounded interval, then dispatch keyup in a finally block. This exercises the actual input handler and network path. Never set world state, player coordinates, or inventory directly.

The read-only `window.tickwright` observer exposes `inspect()`, `block(x,y,z)`, `project(x,y,z)`, and `frames()`. Use `project` to find a visible block's screen position, then actual pointer clicks to edit. Check the changed cell from the other client. Observations may inspect state but cannot replace the user path.

See `features/README.md` for acceptance checks. Run `bun run check` and `bun run build` after changes.

# Evidence

Keep evidence under `.agents/evidence/`. Save screenshots with `preview_snapshot({save:true})`, copy the returned file into that directory, and record actions plus observed values in JSON. Inspect console errors in a fresh tab after the final build; old HMR errors are not current failures.

Run `node scripts/verify-storage.mjs <qa-room>` to read the real Convex HTTP save through the server credential without printing it. Disconnect both clients before testing the last-player save. Restart the room server, reconnect, and confirm the edited cell and world tick were restored. Verify a different room does not inherit the edit.

Performance: use a production client build, document viewport/DPR, GPU renderer, entity counts, CPU load, and five independent frame samples. Check tick advancement and console errors. SwiftShader proves only software rendering; never label it laptop GPU performance. Do not stop unrelated processes to improve a score.

# Cleanup

Navigate QA tabs back to the lobby or close them. Stop only your own dev supervisor via Ctrl+C after verification; restart it if the user needs to play. Keep Convex saves and evidence. Do not delete the user's island or profile. Confirm evidence files remain after teardown.
