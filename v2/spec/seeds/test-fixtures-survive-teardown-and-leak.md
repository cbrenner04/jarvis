---
name: test-fixtures-survive-teardown-and-leak
---

# SIGTERM-ignoring test fixtures survive teardown and leak, pinning cores for days

## Problem

`*.sandbox-unrunnable.test.ts` spawns real subprocess fixtures (`ignore-term.sh`, `hang-agent.sh`
under `$TMPDIR/jarvis-run-*/project/`) that **deliberately ignore SIGTERM** to exercise kill
escalation. When the test process dies mid-run (crash, kill, abandoned run), teardown's SIGTERM
can't reap them, so they leak. Observed 2026-07-17: three `ignore-term.sh` orphans running **3.5
days** at 100% CPU each — three full cores pinned continuously. This is a strong candidate for the
recurring CPU-contention gate flakes the runbook keeps attributing to co-running operators.

## Decisions

- Test teardown (and any harness path that spawns a fixture/agent it may need to kill) must escalate
  to **SIGKILL** on the whole process group after a bounded SIGTERM wait; rules out SIGTERM-only
  teardown that a SIGTERM-ignoring child survives.
- Kill the process **group** (or track+reap the tree), not just the top pid; rules out orphaning a
  grandchild (`hang-agent.sh` → `ignore-term.sh`).

## Out of scope

- Redesigning the fixtures (their SIGTERM-ignoring behavior is the thing under test).

## Documentation updates

- `v1/docs/operator-runbook.md` § stray-process — remove the "sweep leaked jarvis-run fixtures at
  session start" stopgap once this ships (stopgap added alongside this seed).
