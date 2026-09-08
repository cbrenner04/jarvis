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

- Bound every verifier-launched killing-test subprocess to a fixed 30-second `MAX_KILLING_TEST_MS` budget, within the existing five-minute verifier ceiling, and kill its detached process group on expiry; rules out unbounded `runAsync` await and direct-child kill leaving grandchild workers alive.
- Classify timeout as a distinct non-terminating-mutant outcome. In-loop, settle the owning implement completion as retryable `non_terminating_mutation_failed` without a survivor reprompt; during publication, leave the PR draft and settle the same retryable failure, so `jarvis run resume` re-runs finalization rather than re-entering the write agent. Rules out scoring timeout as caught, surviving, or pass.
- Restore pre-mutation bytes in unconditional cleanup before propagating timeout, abort, subprocess failure, or process death; rules out restore-only-after-return leaving a poisoned worktree.
- Record each applied mutant in `<worktree>/.jarvis-diff-derived-mutations/<candidate-sha256>.json`, written atomically before mutation and removed by its owning candidate only after restore. Entries contain file, source line, and mutation text; candidates for different production files retain separate entries while their killing tests run concurrently, so operators can inspect the directory reliably. Rules out operators mistaking unrestored guards for agent edits.
- Keep scanner `while (true)` loops and `jarvis run kill` process-group reaping unchanged; rules out hiding one mutation shape or duplicating `bind-verifier-spawns-to-run-termination`.

## Acceptance criteria

- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves a killing-test subprocess that never exits is terminated at the fixed 30-second per-subprocess budget and the verifier settles; it fails against the pre-fix unbounded await.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves timeout returns a distinct non-terminating-mutant result rather than pass, caught, or `surviving-mutation`, and `v2/src/execution/write-loop.test.ts` proves in-loop and publication callers settle retryable `non_terminating_mutation_failed` without a survivor reprompt, write-agent re-entry, or ready publication; both fail against the pre-fix binary classification.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves pre-mutation bytes are restored after timeout; it fails against the pre-fix restore-only-after-return path.
- [ ] A real-subprocess regression in `v2/src/execution/diff-derived-mutation-verifier.test.ts` drives the `scanDaemonRunControlHandlerForbiddenSymbols` `while (true)` exit-guard flip, observes bounded non-terminating-mutant settlement, and leaves `v2/src/daemon/daemon-run-control-handler-guard.ts` byte-identical to its pre-verification content; it fails against the pre-fix hang.
- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves each concurrent production-file candidate has a separately discoverable `<worktree>/.jarvis-diff-derived-mutations/<candidate-sha256>.json` entry identifying file, source line, and mutation text while applied, and that its owner clears the entry on restore; it fails against the pre-fix absent record.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — fixed 30-second per-candidate killing-test wall clock within the verifier ceiling, distinct retryable completion outcome and resume semantics, restore-on-every-path guarantee, and per-candidate sidecar lifecycle.
- `v2/docs/operator-runbook.md` — a hung verifier child presents as a live run with no agent; inspect `<worktree>/.jarvis-diff-derived-mutations/` before reading a dirty guard as agent work.
- `v2/docs/v1-behaviors.md` — record bounded killing-test execution and guaranteed mutant restore.
