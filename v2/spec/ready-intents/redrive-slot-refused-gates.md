---
name: redrive-slot-refused-gates
---

# Re-drive slot-refused gates when capacity returns

## Prerequisites

- The write loop distinguishes slot contention from ceiling-headroom refusal at the refusal site and checkpoints a quiesced slot-refused iteration before committing its refusal boundary.
- Durable run evidence round-trips the gate-refusal cause and slot re-drive count, including across daemon restart.

## Module-boundary surface

- Daemon lifecycle: lease-availability coordination and retained-lane re-dispatch.

## Problem

The daemon admits concurrent implement lanes but stops every lane whose gate encounters the occupied one-slot lease. It owns the live lease set yet never uses lease availability to re-dispatch the retained lane, leaving operators to resume into the same contention.

## Behavior

- The daemon re-drives slot-contention refusals when a lease becomes available, stops at a fixed bound with every re-drive logged, and never auto-re-drives ceiling-headroom refusals.

## Decisions

- Re-drive only after capacity becomes available; rules out immediate retry churn and holding open the already-announced shell call.
- Re-enter the retained checkpointed lane without an operator command and increment its durable count before each re-drive.
- Use one fixed source-owned bound across fresh and restarted daemon execution; exhausting it settles the lane for operator diagnosis with the bound named.
- Keep ceiling-headroom refusals failed and operator-resumable exactly as today because capacity release cannot repair them.
- Do not raise the gate limit, throttle implement dispatch, or change lease ownership, acquisition, or release semantics.

## Acceptance criteria

- [ ] A daemon write-path regression holds the gate lease, drives a second lane to slot refusal, releases the holder, and proves the retained lane reaches its gate without an operator command; it fails against the pre-fix settle-and-stop behavior.
- [ ] A daemon restart test proves a pending slot re-drive resumes from durable cause/count state without losing its checkpoint or resetting the bound.
- [ ] A test proves ceiling-headroom refusal is never auto-re-driven and retains its current resumable settlement.
- [ ] A test exhausts the slot re-drive bound and proves the lane settles with the bound and final count recorded while every attempted re-drive appears in the run log.
- [ ] Existing one-slot lease ownership tests stay green: `v2/src/execution/write-loop.test.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — release-triggered slot re-drive, durable bound, and unchanged headroom refusal.
- `v2/docs/operator-runbook.md` — § Concurrency recovery after automatic slot re-drive and the remaining headroom-resume case.
- `v2/docs/v1-behaviors.md` — record bounded daemon re-drive as v2-only behavior.
