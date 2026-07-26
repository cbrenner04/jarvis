---
name: guard-bare-settimeout-in-deterministic-tests
---

# Determinism guard flags bare setTimeout/setInterval side effects in guarded tests

## Problem

`scripts/guard-deterministic-daemon-tests.ts` only matches `Bun.sleep` and
`await new Promise((resolve) => setTimeout(…))`. Bare `setTimeout(() => …, ms)` whose
callback drives assertion-critical behavior (the pre-fix `write-loop.test.ts` pattern) slips
through, so flaky wall-clock tests can return after a one-off test fix.

## Decisions

- Flag bare `setTimeout` / `setInterval` in guarded `*.test.ts` files when the callback is not
  part of a bounded polling loop (`Date.now() < deadline` or `signal?.aborted` while) — rules out
  fixing only the write-loop case without guard coverage.
- Production `setInterval` under `v2/src/**` outside guarded test files and bounded polling
  helpers in tests stay clean — rules out banning the identifier globally.
- A fixture in guard tests exercises the pre-fix write-loop `setTimeout(() => abort(), ms)` pattern
  and must be flagged — rules out testing the rule only against synthetic one-liners.

## Acceptance criteria

- [ ] `findDeterminismViolations` reports a violation for bare `setTimeout` / `setInterval`
      callbacks in a guarded test file when the callback is not part of a bounded polling loop; the
      write-loop-style fixture is flagged.
- [ ] Bounded polling that uses `setTimeout` inside a `Date.now() < deadline` or `signal?.aborted`
      while loop still reports no violation.
- [ ] Inverting the new rule fails a test in `scripts/guard-deterministic-daemon-tests.test.ts`.
- [ ] `bun run check` is green on the whole tree — any other guarded file that trips the new rule is
      fixed in the same change.

## Documentation updates

- `v2/docs/test-writing.md` § Deterministic daemon and execution tests — bare `setTimeout` /
  `setInterval` whose real-clock firing an assertion depends on is timer-backed wait and is guarded.
- `v2/docs/operator-runbook.md` — extend the forbidden-pattern bullet to include bare
  `setTimeout` / `setInterval` callbacks, not only `await new Promise(…setTimeout…)` and
  `Bun.sleep`.

## Prerequisites

Both satisfied on `main`: `write-loop-abort-watchdog-ordering-without-real-clock` shipped and is in
`v2/spec/completed/20260725T135459Z-write-loop-abort-watchdog-ordering-without-real-clock`, so the
write-loop abort-vs-watchdog test already drives ordering through injected control.
