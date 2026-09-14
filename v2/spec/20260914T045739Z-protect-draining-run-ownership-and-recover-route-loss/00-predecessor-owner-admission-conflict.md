# 00 — Predecessor-owned runs block successor admission and force claims

## Problem

The stable daemon's `resume`, `start` (worktree lease), and forced `kill` settlement check only successor-local `activeRuns`/store rows, so they can claim a run or its protected worktree still driven by a reachable draining predecessor (#3595, #3464).

## Decisions

- Consult the direct-predecessor ownership directory (`observeRunOwnership` / `resolveOwner`) on the stable address before `resume` admission, `start` worktree-lease claim, and `kill` force settlement; an owner hit is a conflict error, not a local claim — rules out claiming by durable row status alone.
- Conflict applies only to the owned run and its worktree; unrelated `start` and eligible `resume` stay admitted — rules out a daemon-wide "predecessor draining" readiness gate.
- A paused run owned by the predecessor is controlled via existing routed `pause`/`kill`/`wait`; successor never force-settles it while the owner answers (#3464).
- No predecessor socket, or ownership-directory setup failure, falls back to existing per-daemon admission — rules out a routing-unavailable blanket refusal.
- Private endpoints keep local-only admission; wrapping applies to stable-address handlers only, matching `createStableRunHandlers`.

## Acceptance criteria

- [ ] A concurrency regression drives the stable daemon with a reachable predecessor owning a run and proves `resume`, `start` on its worktree, and forced `kill` all refuse without claiming the run or lease; it fails against the pre-fix successor-local ownership checks.
- [ ] A regression proves an unrelated `start` and an eligible `resume` of a non-predecessor run are admitted on the incoming generation while the predecessor drains.
- [ ] A setup-failure regression proves that when the ownership directory cannot be established, public verbs keep existing per-daemon behavior with no routing-unavailable refusal.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — admission and force-claim pinning to a reachable direct predecessor owner.
- `v2/docs/v2-architecture.md` — stable front door never drives one invocation from two generations.
- `v2/docs/v1-behaviors.md` — draining ownership prevents duplicate admission.
