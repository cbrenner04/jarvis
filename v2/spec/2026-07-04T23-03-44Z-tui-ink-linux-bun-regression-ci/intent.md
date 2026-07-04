---
name: tui-ink-linux-bun-regression-ci
---

# TUI ink Linux/Bun regression CI

CI runs a hermetic Linux/Bun check that production ink loading does not throw `Cannot access 'Yoga' before initialization`.

## Decisions

- Add the regression job only when it is hermetic without a live terminal, running daemon, or operator interaction — rules out manual-only or flaky integration checks as the sole guard.
- Assert production ink module load through the shared lazy boundary, not a full interactive TUI session — rules out daemon-dependent e2e as the minimum regression.
- Deferred to first consumer: exact CI workflow/job placement — pin when wiring harness if multiple Linux runners exist.

## Prerequisites

- Production `jarvis tui` ink surfaces load without `Cannot access 'Yoga' before initialization` on Linux/Bun.

## Documentation updates

- `v2/docs/write-behavior.md` Verification — cite the new regression command when added.
