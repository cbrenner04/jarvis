# Write-loop non-terminating settlement

## Problem

In-loop and publication callers today classify every verifier failure as either caught (continue), `surviving-mutation` (reprompt or `surviving_mutation_failed`), or pass. A non-terminating mutant is not a coverage miss — reprompting the implement agent or scoring it as survived misroutes recovery.

## Decision ledger

- Settle in-loop `non-terminating-mutation` as retryable `non_terminating_mutation_failed` without `surviving_mutation_reprompt` or write-agent re-entry; rules out survivor reprompt on a harness-timeout mutant.
- Settle publication-time `non-terminating-mutation` the same way, leaving the PR draft and exposing `nextAction: "resume"` that re-runs finalization rather than re-entering the implement write loop; rules out ready publication or `surviving_mutation_failed` resume semantics for this outcome.
- Add `non_terminating_mutation_failed` to durable terminal outcome kinds and log fields mirroring surviving-mutation site detail without `dualConstraint`; rules out overloading `surviving_mutation_failed` or `runtime_smoke_failed`.

## Prerequisites

- Subspec 00 exports `non-terminating-mutation` from `verifyDiffDerivedMutations`.

## Task checklist

- Handle `verificationResult.kind === "non-terminating-mutation"` in implement in-loop verification (`write-loop.ts`) and publication finalization tail with terminal `non_terminating_mutation_failed` settlement (no reprompt, no ready flip).
- Extend persistence/log-stream terminal fields and resume admission so `jarvis run resume` on this failure re-runs ready finalization confirm-only paths without implement re-entry.
- Add `write-loop.test.ts` regressions for in-loop and publication callers.

## Acceptance criteria

- [x] `write-loop.test.ts` proves in-loop verification settling `non-terminating-mutation` records retryable `non_terminating_mutation_failed` without `surviving_mutation_reprompt`, write-agent re-entry, or ready publication; it fails against the pre-fix binary classification that reprompts or scores `surviving_mutation_failed` on verifier failures.
- [x] `write-loop.test.ts` proves publication-time verification settling `non-terminating-mutation` records retryable `non_terminating_mutation_failed`, leaves the PR draft, and does not reprompt implement or flip ready; it fails against the pre-fix publication path that settles `surviving_mutation_failed` or proceeds to ready.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- Deferred to subspec 04.
