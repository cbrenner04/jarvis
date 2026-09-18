---
name: daemon-changeover-rebind-test-flakes-under-load
---

# Daemon-changeover rebind test flakes under load

## Problem

`daemon handoff changeover (real sockets) > a committed handoff watch retries a rebind bind failure and eventually rebinds` (`v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts:877`, added by #4022) fails under full-suite load and passes in isolation (26/0 three times on `main` and branch, 2026-09-18). Load-sensitive element: `:897` `waitFor(() => answersHealth(...), 3_000)` is a private wall-clock deadline (`waitFor`, `:61`, polls `Date.now()` against it) that must cover the commit, a failed rebind, and a successful retry tick at `fallbackMs: 100` (`:881`), each needing event-loop time plus a `health` round-trip. Under `test:integration:v2` concurrency the deadline measures machine load, not behavior. Same shape as `wal-handshake-has-no-private-deadline`.

## Evidence (2026-09-18)

1. Implement run for spec `20260918T110642Z-ready-gate-autofix-best-effort-on-unfixable-lint` (pipeline `f91e8816`, PR #4048): ready gate failed on this file; base-ref probe also saw 25 pass / 1 fail on `main` `fe48cd9bf` under load. Run settled `ready_gate_out_of_scope` / `nextAction: stop` (non-resumable); lane stranded and was hand-finished.
2. Hand `bun run test:integration:v2` in that worktree on an otherwise idle machine failed the same test (276ms).

## Decisions

- Remove the private deadline the way `v2/spec/completed/20260909T042005Z-wal-handshake-has-no-private-deadline` did (`waitForStdoutMarker`): wait on the observable event (successful rebind / health answer) bounded only by the test's own suite timeout (`15_000`). Rules out raising the 3s number.
- Prefer an event signal (e.g. resolve a promise when the injected `bind` succeeds for the third public bind) over polling where the seam allows.
- Audit sibling `waitFor(..., N_000)` calls in the same file for the same shape; fix those that gate a pass/fail verdict on wall-clock, keep ones asserting a negative within a window.
- Test-only change; no daemon behavior change.

## Acceptance criteria

- [ ] The rebind test has no private wall-clock deadline shorter than its suite timeout; it waits on the rebind event.
- [ ] The test still fails if the committed watch never retries after the injected bind failure.
- [ ] The test passes 5 consecutive times under `bun run test:integration:v2` concurrency.
- [ ] `bun run typecheck`, `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- None expected; if the audit changes a shared test helper convention, note it in `v2/docs/operator-practices.md` flake guidance.
