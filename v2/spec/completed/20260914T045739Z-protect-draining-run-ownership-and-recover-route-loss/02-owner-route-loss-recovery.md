# 02 — Owner-route loss drops routed liveness and reaches dead-owner recovery

## Problem

When the internal owner channel to the draining predecessor is lost, routed liveness can linger and the run can be neither live nor reconciled, or be silently claimed.

## Decisions

- On route loss (ownership poll failure / `absent`/`stale` probe), the run stops reading live at the stable address — rules out retaining the last owner snapshot as live.
- Recovery goes only through existing dead-owner safety (`owner_identity` + process liveness, `forceKillOwnerAdmits`, orphan reconciliation); the successor never silently claims, settles, or re-executes — rules out auto-adopting the run on channel loss.
- A route loss where the owner process is still alive (channel error only) is not orphanhood; the row is not reconciled until process liveness says dead.

## Acceptance criteria

- [x] A failure-path regression severs the owner route mid-drain and proves `run list` no longer reports the run live, routed controls fall back to local behavior, and the run reaches existing dead-owner reconciliation/recovery without duplicate execution; it fails against the pre-fix code.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — owner-route loss behavior.
- `v2/docs/v2-architecture.md` — recovery boundary after owner-route loss.
- `v2/docs/v1-behaviors.md` — route loss preserves honest recovery.
