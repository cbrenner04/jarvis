---
name: bound-diff-derived-mutant-execution
---

# Bound diff-derived mutant execution

Unsplit rationale: Per-candidate timeout, distinct non-terminating settlement, guaranteed restore, and active-mutation diagnostics are one execution-loop verifier lifecycle; daemon run-kill reaping is a separate seed.

## Primary implementation surface

- Execution-loop diff-derived mutation verification in `v2/src/execution/diff-derived-mutation-verifier.ts`

## Prerequisites

- Shared async subprocess execution supports per-call wall-clock timeouts and detached process-group SIGTERM-to-SIGKILL termination.
- Diff-derived verification resolves scoped killing tests per candidate, serializes candidates per production file, and caps concurrent verifier test subprocesses.

## Problem

The diff-derived mutation verifier applies a mutant, awaits scoped killing tests via unbounded `runDiffDerivedScopedTests`, and restores only after the await settles. A guard-flip on a `while (true)` exit condition never terminates, so verification hangs indefinitely, the worktree keeps the inverted guard, and the owning run stays live with no agent past every watchdog.

## Decision ledger

- Bound every verifier-launched killing-test subprocess with a per-invocation wall clock and kill its process group on expiry; rules out unbounded `runAsync` await and direct-child kill leaving grandchild workers alive.
- Classify timeout as a distinct non-terminating-mutant outcome at verifier and write-loop boundaries; rules out scoring timeout as caught, surviving, or pass.
- Restore pre-mutation bytes in unconditional cleanup before propagating timeout, abort, subprocess failure, or process death; rules out restore-only-after-return leaving a poisoned worktree.
- Record applied mutants in a worktree-local sidecar written before mutation and cleared only after restore; rules out operators mistaking unrestored guards for agent edits.
- Keep scanner `while (true)` loops and `jarvis run kill` process-group reaping unchanged; rules out hiding one mutation shape or duplicating `bind-verifier-spawns-to-run-termination`.

## Acceptance criteria

- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves a killing-test subprocess that never exits is terminated at the configured per-subprocess wall clock and the verifier settles; it fails against the pre-fix unbounded await.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves timeout returns a distinct non-terminating-mutant result rather than pass, caught, or `surviving-mutation`, and `v2/src/execution/write-loop.test.ts` proves in-loop and publication callers settle the matching distinct completion failure without a survivor reprompt; both fail against the pre-fix binary classification.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves pre-mutation bytes are restored after timeout; it fails against the pre-fix restore-only-after-return path.
- [ ] A real-subprocess regression in `v2/src/execution/diff-derived-mutation-verifier.test.ts` drives the `scanDaemonRunControlHandlerForbiddenSymbols` `while (true)` exit-guard flip, observes bounded non-terminating-mutant settlement, and leaves `v2/src/daemon/daemon-run-control-handler-guard.ts` byte-identical to its pre-verification content; it fails against the pre-fix hang.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves the applied-mutation sidecar identifies file, source line, and mutation text while a mutant is applied and is cleared on restore; it fails against the pre-fix absent record.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — per-candidate killing-test wall clock, distinct non-terminating outcome, restore-on-every-path guarantee, and applied-mutation sidecar lifecycle.
- `v2/docs/operator-runbook.md` — a hung verifier child presents as a live run with no agent; inspect the applied-mutation sidecar before reading a dirty guard as agent work.
- `v2/docs/v1-behaviors.md` — record bounded killing-test execution and guaranteed mutant restore.
