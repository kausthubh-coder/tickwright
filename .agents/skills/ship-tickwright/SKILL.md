---
name: ship-tickwright
description: Ship Tickwright only when the user explicitly asks to deploy, release, or ship. Covers Convex, the Worker, Vercel, and Clerk.
---

# Release order

This flow is a draft until the first hosted deployment is verified. No Git remote is configured in the initial checkout. Do not invent a repository or cloud project.

1. Run `git status --short`, `bun run check`, and `bun run build`. Drive changed paths with `verify-tickwright`. Confirm the intended commits and record the previous hosted versions for rollback.
2. Ensure the user selected the Clerk, Convex, Cloudflare, and Vercel applications. Request missing secrets privately. Never print or commit them. Verify Clerk token checks and allowed origins before exposing rooms.
3. Deploy Convex functions first with `bunx convex deploy` against the intended production deployment, only after the user's production go. Configure the shared server secret in Convex and Wrangler secrets, never Vite variables.
4. Deploy the authoritative room Worker with `bunx wrangler deploy` after setting its Convex site URL and Clerk issuer/origin configuration. Do not bypass the hosted authentication guard.
5. Build the client with its room WebSocket URL and Clerk publishable key. Deploy a preview using `bunx vercel deploy`; production requires separate authorization. A Vercel URL alone cannot host the room server.
6. Open two hosted browser clients, sign in, join one room, move and edit a block, then reconnect and confirm the saved edit. Check unauthorized requests fail. Record the exact URLs and evidence.
7. Only perform Git landing/push when a remote and branch policy have been established with the user. Never force-push, reset main, or delete a worktree as part of an unverified release.

Rollback means restoring the prior client and Worker versions. Preserve Convex world saves; do not wipe data to revert a schema.
