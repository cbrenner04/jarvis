---
name: daemon-force-settles-stale-nonactive-run
---

# Daemon force-settles a stale non-active run to `killed`

## Primary implementation surface

`v2/src/daemon/daemon.ts`

Unsplit rationale: The whole change is one force branch on the daemon `kill` RPC reusing the existing `commitGuardedKill` state transition; there is no second module boundary to split across.

## Problem

`killHandler` (`v2/src/daemon/daemon.ts`) only acts on a row tracked in `activeRuns`; every other row gets `run_not_active`. A `paused` row that `resume` refuses with `unsupported_resume_context` has no in-memory loop, so it is neither resumable nor killable. `paused` is not terminal, so `retainListedRuns` never ages it out of the 50-newest-terminal window and it paints in `run list` and the tui work tree indefinitely (observed 2026-08-16 on two 2026-08-11 rows for `20260811T173344Z-tui-left-pane-width-and-timing-threshold`).

## Decisions

- Add a force path on the existing `kill` RPC (`force?: boolean` param) rather than a new RPC verb — rules out a second verb that the tui client, wire docs, and CLI would each have to learn.
- Force applies only when the row is non-active and non-boundary-terminal; an active row takes the existing abort path whether or not `force` is set — rules out force becoming a way to skip a live loop's abort/checkpoint sequence.
- Force settles durably through a state-store transition that records `killed` plus `finished_at`, reusing `commitGuardedKill`'s boundary-terminal guard — rules out deleting the row or hand-writing status without a finish timestamp, either of which breaks `finishedAtMs` projection and terminal retention.
- Force does not consult resume admissibility: any non-active, non-boundary-terminal row is settleable. Rules out gating on `unsupported_resume_context`, which would leave every other flavor of stuck non-active row unclearable and couple kill to resume's reconstruction logic.
- No change to `resume`, `pause`, or reconstruction semantics.
- Startup reconciliation is out of scope: `beginRunReconciliation` already settles `paused` rows whose owner process is dead. The residual gap is a `paused` row owned by a still-live daemon, which no startup sweep can reach — that is exactly what the force path covers.

## Acceptance criteria

- [ ] `kill` with `force` on a `paused` row that has no `activeRuns` entry responds ok and leaves the durable row `killed` with a non-null `finished_at`, pinned by a daemon test.
- [ ] `kill` without `force` on that same row still responds `run_not_active`, pinned by a test.
- [ ] `kill` with `force` on an active run takes the normal abort path (loop aborted, durable `killed`) and does not bypass it, pinned by a test.
- [ ] `kill` with `force` on a boundary-terminal row (`completed`/`blocked`/`failed`) responds `run_not_active` and leaves the recorded status and `finished_at` unchanged, pinned by a test.
- [ ] A force-settled row is excluded from `list` once 50 newer terminal rows exist, pinned by a retention test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `kill` RPC row gains the `force` param and its non-active force-settlement semantics; note that force-settled rows are ordinary terminal rows for retention and `finishedAtMs`.

## Prerequisites
