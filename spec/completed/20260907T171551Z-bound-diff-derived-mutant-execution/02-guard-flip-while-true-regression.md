# Guard-flip while-true regression

## Problem

The production `scanDaemonRunControlHandlerForbiddenSymbols` scanner uses `let from = 0; while (true) { indexOf(...); if (index === -1) break; … }`. A verifier `guard-flip: === → !==` on that exit guard is non-terminating and hung a real lane for hours on the pre-fix unbounded await (see `v2/spec/seeds/mutation-verifier-hangs-forever-on-a-non-terminating-mutant.md`).

## Decision ledger

- Pin the regression with a real-subprocess test that drives the committed `while (true)` loop shape through diff-derived verification without production invert hooks; rules out rewriting scanner loops to hide one mutation shape.
- Assert bounded `non-terminating-mutation` settlement and byte-identical restoration of `v2/src/daemon/daemon-run-control-handler-guard.ts`; rules out accepting hang or leaving the inverted guard in the worktree.

## Prerequisites

- Subspec 00 lands `MAX_KILLING_TEST_MS`, `non-terminating-mutation` classification, and guaranteed restore.

## Task checklist

- Add a real-subprocess `diff-derived-mutation-verifier.test.ts` case that diffs a changed line inside `scanDaemonRunControlHandlerForbiddenSymbols`'s `while (true)` exit guard, runs verification against the real killing test `v2/src/daemon/daemon-run-control-handler-guard.test.ts`, and snapshots pre/post file bytes.
- Do not add `setInvert*ForTest`, `invert*ForTest`, `invert*` parameters, or `invert*ForTest` type members to production code.

## Acceptance criteria

- [x] `diff-derived-mutation-verifier.test.ts` drives the `scanDaemonRunControlHandlerForbiddenSymbols` `while (true)` exit-guard flip, observes bounded `non-terminating-mutation` settlement, and leaves `v2/src/daemon/daemon-run-control-handler-guard.ts` byte-identical to its pre-verification content; it fails against the pre-fix hang reachable when `runDiffDerivedScopedTests` awaits a non-terminating killing test indefinitely.
- [x] `bun run test:v2` passes.

## Documentation updates

- Deferred to subspec 04.
