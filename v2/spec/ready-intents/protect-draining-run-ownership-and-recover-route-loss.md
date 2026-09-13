---
name: protect-draining-run-ownership-and-recover-route-loss
---

# Protect draining run ownership and recover route loss

## Prerequisites

- Daemon upgrades hand off one stable public address: the incoming generation admits new work, the outgoing generation admits nothing new, finishes its owned work, and exits when idle.
- The stable daemon merges its direct predecessor's authoritative live run rows into `run list`, with one row per run and the live owner's row winning.
- The stable daemon routes waits and owner-sensitive live controls for a draining run to its direct owner over the internal handoff channel.
- The stable daemon replays and follows a draining run's log from its direct owner over the internal handoff channel.

## Module-boundary surface

- Run admission, ownership claims, and orphan reconciliation when a predecessor route is present or lost.

## Problem

The successor's local registry does not contain predecessor-owned work. Start, resume, or force paths can therefore claim work already driven by a reachable draining owner, while loss of the owner channel can leave stale routed liveness or bypass genuine orphan reconciliation.

## Behavior

- A reachable draining owner remains the sole driver of its active run; the incoming generation admits new and eligible resumable work without claiming that run, and loss of the owner route removes routed liveness and enters existing safe ownership-loss reconciliation/recovery.

## Decisions

- Regression cases inherited from closed seeds: #3595 (a run dispatched during handoff must not be swallowed or leave an orphaned worktree lease) and #3464 (a draining owner's paused run must stay controllable, never force-killed or claimed by the incoming generation while its owner is alive).

- Treat an authoritative predecessor owner as an admission and force-claim conflict for that run and its protected worktree ownership; never drive one invocation from two generations.
- Keep unrelated `start` and eligible `resume` admission on the incoming generation; routing availability is not a daemon-wide readiness gate.
- Always run startup reconciliation during handoff and continue to decide genuine orphanhood from durable owner identity and process liveness, not mere peer presence.
- On owner-channel loss, stop reporting the run live and reconcile/recover only through existing dead-owner safety; do not silently claim, settle, or retain it as live.
- Routing setup failure degrades to existing per-daemon admission and reconciliation behavior rather than refusing all verbs.

## Acceptance criteria

- [ ] A concurrency regression proves the incoming generation cannot start, resume, or force-claim work pinned to a reachable draining owner; it fails against the pre-fix successor-local ownership checks.
- [ ] A regression proves unrelated new work and eligible resumptions remain admissible on the incoming generation while the predecessor drains.
- [ ] A startup regression proves genuinely orphaned rows are still reconciled during handoff while live predecessor-owned rows are preserved.
- [ ] A failure-path regression proves loss of the internal owner route removes routed liveness and reaches existing dead-owner reconciliation/recovery without duplicate execution or a false live report.
- [ ] A setup-failure regression proves public verbs retain existing per-daemon behavior without a routing-unavailable blanket refusal.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — admission pinning, startup reconciliation during handoff, and owner-route loss behavior.
- `v2/docs/v2-architecture.md` — stable-front-door ownership and recovery boundary.
- `v2/docs/v1-behaviors.md` — draining ownership prevents duplicate admission and route loss preserves honest recovery.
