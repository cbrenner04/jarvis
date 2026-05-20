# 00 - Identify and fix the hanging test in test/run.test.ts

## Problem

A `bun test` run launched by `bun run ready` (invoked transitively by an
agent during `jarvis run`) hangs indefinitely. Observed instance: PID 6951
(`bun test`) ran for 2h+ with the process state `R+` (on-CPU), a single main
thread spinning in JavaScript, no file-descriptor I/O, no open pipes or
sockets to a child, and one already-reaped defunct child (PID 8398).

Diagnostic evidence collected from the live hang:

- `sample 6951 5` shows the main thread is on-CPU inside the JavaScript
  engine, not blocked on a syscall.
- `lsof -p 6951` shows zero open pipes/sockets — the defunct child's
  pipes were already closed.
- `fs_usage` shows zero new filesystem activity for the duration of the
  hang.
- The two newest temp directories in `$TMPDIR` are `jarvis-run-HXMGpO`
  (14:29) and `jarvis-run-n4GFWw` (14:30), matching the prefix used **only**
  by `test/run.test.ts:106` (`mkdtempSync(join(tmpdir(), "jarvis-run-"))`)
  in this repository.

These observations together place the hang inside a test in
`test/run.test.ts` whose `beforeEach` created `jarvis-run-n4GFWw` and whose
body then entered an unrecoverable state. The most likely failure shape,
given the reaped defunct child plus on-CPU-but-no-I/O main thread, is a
race in `runCommand`'s agent stream handling where a spawned agent child
exits before producing any output and the harness `await`s a stream event
(`close`, `end`, or a frame parse) that never arrives.

This subspec covers the **specific bug**: the test that hangs, and the
code path it exercises. The broader hardening (per-test timeout backstop,
ready-script deadline, iteration-watchdog reliability) is split across
subspecs 01–03.

## Scope and decisions

- The exact failing test name and root cause are not yet pinned. The first
  task in this subspec is to name the test by running
  `bun test test/run.test.ts --bail --timeout 60000` from a clean checkout
  on `main` and recording the hanging test's `describe` + `test` chain.
- Once named, the implementer reads the test and the `runCommand` /
  agent-spawn paths it exercises and pins the root cause. The fix lives in
  the smallest possible scope (`src/run.ts`, `src/agents/*`, or whichever
  helper owns the race) — no opportunistic refactors.
- The regression test for the fix lives alongside `test/run.test.ts` (or
  in a new sibling file if the existing test layout makes that clearer).
  It must reproduce the specific failure mode (e.g. a fake agent whose
  spawned child exits before emitting any frames) and complete in well
  under 5 s on a clean checkout.
- Subspec 01 adds a default per-test timeout so a future regression
  surfaces as a test failure within 30 s instead of a wedged suite. That
  backstop is **not** a substitute for fixing the underlying bug.

## Task checklist

- Reproduce the hang on `main` and pin the failing test's full
  `describe`/`test` name.
- Read the failing test and the `runCommand` and agent-spawn code paths it
  exercises; document the root cause in this file (replace this checklist
  item's text with a one-paragraph root cause statement when known).
- Implement the smallest fix that resolves the race.
- Add a regression test that fails on the pre-fix code and passes on the
  fixed code.
- Run `bun run typecheck`, `bun test`, and `bun run check`.

## Acceptance criteria

- [ ] The hanging test in `test/run.test.ts` is named in this subspec's
  task checklist, with a one-paragraph root-cause statement.
- [ ] The previously-hanging test passes in under 5 s on a clean
  checkout: `bun test test/run.test.ts -t "<failing test name>"`.
- [ ] A new regression test reproduces the specific failure mode (e.g. a
  fake agent whose spawned child exits before emitting any frames does
  not hang `runCommand`); the test fails on the pre-fix code and passes
  on the fixed code.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes (full suite, no `--bail`).
- [ ] `bun run check` passes.

## Documentation updates

- If the root cause turns out to involve agent stream/close semantics
  that operators or future contributors should know about, add a short
  note to `docs/agents.md` or `docs/run-loop.md`. Otherwise no
  user-facing documentation changes are required (this is an internal
  fix).
