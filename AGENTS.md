# Tickwright

The playable client is in `apps/client`, the PartyServer room in `apps/server`, the deterministic rules in `packages/sim`, and durable saves in `convex`.

Every task in a new worktree starts with `.agents/skills/worktree-tickwright/SKILL.md`.
Ship only with `.agents/skills/ship-tickwright/SKILL.md`, when the user says so.
Before reporting a feature works, use `.agents/skills/verify-tickwright/SKILL.md` and exercise it in two browser clients.

- Setup: `bun run setup`. Doctor: `bun run doctor`. Local play: `bun run dev`.
- Checks: `bun run check` and `bun run build`.
- Shared simulation changes need deterministic replay, collision, and spawn-rule tests.
- Convex owns saved worlds. PartyServer owns live ticks. Do not write player positions to Convex on every tick.
- Guest access is local only. Hosted play requires verified Clerk sessions.
- Human-facing reports and instructions belong in HTML, not Markdown.
- Do not claim the GPU frame-rate target from SwiftShader browser measurements.
- Do not remove a worktree or stop another thread's processes without verifying ownership and authorization.
- Keep the user's current feature branch. Do not push to production without their explicit go.
