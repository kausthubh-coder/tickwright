---
name: worktree-tickwright
description: Set up Tickwright in a new checkout, or diagnose its dependencies, local ports, Convex backend, or room server.
---

# Local setup

Run `bun run setup`, then `bun run doctor`. Setup reserves four ports in the shared Git directory by absolute checkout path and writes `.local/ports.json`. It installs the locked dependencies and links `.claude/skills` to `.agents/skills`.

Run `bun run dev`. The supervisor starts an anonymous local Convex backend, deploys functions, configures a generated local server credential without printing it, starts Wrangler, then Vite. Wait for `PLAY: http://127.0.0.1:<port>` and Vite's ready line.

Read the client port from `.local/ports.json`. The current checkout uses 15048 for the client; another checkout must use its own reservation. Local data stays in that checkout's Convex deployment and `.local/worker`. Never copy `.env.local`, `.dev.vars`, or `.local` from another checkout.

Do not use a shared cloud Convex deployment for local tests. `CONVEX_AGENT_MODE=anonymous` is set by the supervisor. No Clerk login is needed for loopback guest play.

# Isolation and cleanup

The initial checkout is `C:/Users/kaust/.t3/projects/farm-game`. It is currently on a feature branch. Do not switch it to main or reset it.

If explicitly delegated a separate checkout, use `git worktree add` under the same parent, then run setup there. Never share its ports or world state with another agent.

Ctrl+C in the terminal that launched `bun run dev` stops that supervisor's children. `.local/processes.json` records their creation context. Verify PID command lines and ancestry before any manual termination. Never kill by executable name.

Remove only merged or explicitly authorized worktrees, after checking T3 for a live thread. Stop the worktree's own supervisor. Remove its `.claude/skills` junction without recursion, then run `git worktree remove <absolute-path>` from a different checkout. Do not recursively delete a computed path as a fallback.

Current verification: setup, doctor, and dev were run in the initial checkout. Simultaneous fresh-worktree isolation remains unverified. No global T3 settings were changed.
