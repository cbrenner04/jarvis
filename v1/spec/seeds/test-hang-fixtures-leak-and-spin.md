---
name: test-hang-fixtures-leak-and-spin
---

# Watchdog/idle test hang-fixtures leak as orphans and busy-loop at 100% CPU

The sandbox-unrunnable watchdog/idle tests spawn helper shell scripts
(`idle-hang.sh`, `agent-only-hang.sh`, …) under per-test temp dirs
(`jarvis-run-*`, `jarvis-patch-review-parent-*`) to simulate a hung or
output-silent agent. Two failure modes compound:

1. **They spin instead of idle.** A fixture meant to model an *idle* (no-output)
   agent busy-loops, pegging a full core at ~100% CPU rather than sleeping.
2. **They leak on abnormal exit.** When the parent test/run is killed (watchdog
   kill, Ctrl-C, crash), the helper survives as an orphan in its temp dir; nothing
   reaps it.

Observed 2026-06-28: two orphaned fixtures (`idle-hang.sh` in
`jarvis-patch-review-parent-bbYTTE`, `agent-only-hang.sh` in `jarvis-run-82Yw1A`)
were each pinning a core at 100% for **hours** after their parent runs were long
gone — found during an unrelated operator session. The operator could not even
reap them directly (auto-mode classifier blocks killing processes it did not
spawn), so cleanup required a manual `kill` by the human.

## Problem

Leaked spinning fixtures silently steal CPU from every later run on the machine —
exactly the contention class the operator runbook warns degrades gate timing.
Because they outlive their test and burn a core each, they accumulate across
sessions and there is no automatic cleanup or even a detect-and-warn.

## Decisions

- **Idle fixtures sleep, don't spin.** A fixture simulating an idle/no-output
  agent blocks (e.g. `sleep`/`read`), consuming ~0% CPU — rules out busy-loops
  that model "idle" with a hot core.
- **Fixtures self-terminate.** Each hang helper exits on its own after a bound
  comfortably above the longest watchdog window it is exercised against (or on
  parent death via PID watch), so a leaked orphan dies on its own — rules out
  unbounded survivors.
- **Tests reap their spawned process trees.** Test teardown kills the helper's
  process group even when the test body throws or is killed mid-run — rules out
  relying on the OS to clean up.
- Scope is the test fixtures + their teardown, not the production watchdog — the
  production orphan-reaping path is separate (and already exists).

## Out of scope

- Production watchdog/orphan-reaping behavior (separate path).
- The auto-mode classifier blocking operator `kill` of non-self-spawned procs
  (operator-environment, not a harness gap).

## Documentation updates

- `v1/docs/operator-runbook.md` — once fixtures self-clean, the "watch for
  leaked `*-hang.sh` orphans pegging CPU" manual check (if added meanwhile) can be
  dropped (cleanup trigger).

## Prerequisites

- Watchdog/idle behavior is covered by `*.sandbox-unrunnable.test.ts` suites that
  spawn real helper processes.
