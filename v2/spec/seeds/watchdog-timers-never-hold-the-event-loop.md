---
name: watchdog-timers-never-hold-the-event-loop
---

# Armed watchdog timers never keep a bun process alive

## Problem

The write-loop ceiling/idle-output watchdogs and review role/idle timers are real timers that are not `.unref()`'d. Surfaced by #3060 (config-parity subspec 01): once daemon-dispatched steps carry stamped timeout fields, `pipeline-execution.test.ts` arms those watchdogs and the file hangs — module loads and 109/109 tests pass, but pending timers hold bun's event loop so the process never exits (reproduced locally and on CI; bisected to any armed timer field). On `main` the daemon path never stamped the fields, so the timers never armed there — the latent defect was masked by the parity bug that spec fixes. Any short-lived process that arms a watchdog and finishes early has the same exposure.

## Decisions

- Every watchdog/timeout timer in the write loop and review execution is `.unref()`'d (or managed by a scheduler that is), so a pending watchdog never keeps a process alive; cancellation on settle is unchanged. Rules out fixing only the one test file with fake timers.
- Tests that assert watchdog behavior drive fake timers; no test waits out a real watchdog. Rules out reintroducing wall-clock hangs.
- If #3060's hand-finish already lands the `.unref()` fix, this seed is reaped with a pointer to that PR. Rules out double-implementing.

## Acceptance criteria

- [ ] A process that arms each watchdog kind and reaches settle exits without waiting for the timer, pinned by a test that fails against a ref'd timer.
- [ ] `pipeline-execution.test.ts` passes with stamped timeout fields present (the #3060 repro), pinned.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — watchdog timers are unref'd; liveness is owned by the loop, not the timer.
