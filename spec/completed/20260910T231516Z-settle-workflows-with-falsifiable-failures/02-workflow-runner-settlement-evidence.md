# Intent and implement runner settlements carry evidence

## Problem

The workflow runner's own terminal settlements in `v2/src/execution/workflow-runner.ts` — the intent path's unresolvable-publication-agent settlement and `settleWorkflowPublicationFailure` for implement publication failures — write a `terminalCause` and an `InvocationFailureDetail` message with no expectation, no observation, and no retryability, so the operator cannot check the verdict or tell a reissuable failure from a fixed point.

## Decisions

- Populate `operatorFailureRecord` at the two existing runner settlements only; no unrelated check is rewritten and no new failure kind is introduced.
- `expectation` and `observation` are derived where each check settles, from the facts that check already compared; rules out a later composer reverse-engineering facts from verdict text.
- The unresolvable-publication-agent settlement — workflow-runner.ts's "no completion agent available to attribute the publication commit" terminal settlement — is `retryable: true` (agent configuration can change between reissues).
- `settleWorkflowPublicationFailure`'s call site computes a local `publicationResumable`; that value becomes the one predicate feeding the record's `retryable`, `loop_finished.resumable`, and the returned result's `resumable` — one computed value, not two. It reuses subspec 01's extended `readyFailureResumable` for the seven kinds `WorkflowPublicationFailureKind` shares with `ReadyFailureKind` (so a `readyGateOrigin: "repair_budget_exhausted"` settlement is `retryable: false` and a `baseRefProbeError` settlement is `retryable: true`, same precedence as subspec 01); `completion_commit_failed` — the one kind `WorkflowPublicationFailureKind` adds beyond `ReadyFailureKind` — keeps its existing `retryable: true` default, since a commit-mechanics failure is not a repair fixed point.
- Paths referenced by these settlements carry origin at the producer that resolves them: the worktree and spec path are `operator-repository`.

## Task checklist

- [ ] Build the record at the unresolvable-publication-agent settlement.
- [ ] Build the record at `settleWorkflowPublicationFailure`'s call site, sourcing `loop_finished.resumable` and the returned result's `resumable` from the same reused predicate.
- [ ] Tests and docs.

## Acceptance criteria

- [x] `v2/src/execution/workflow-runner-publication.test.ts` proves a representative failure at the unresolvable-publication-agent settlement settles a run row whose `operatorFailureRecord` states expectation, observation, and `retryable: true`; it fails against the pre-fix verdict-only settlement.
- [x] `v2/src/execution/workflow-runner-publication.test.ts` proves a representative implement-publication failure with `readyGateOrigin: "repair_budget_exhausted"` settles a populated `operatorFailureRecord` whose `retryable` matches `loop_finished.resumable`; it fails against the pre-fix verdict-only settlement. (Originally asserted `retryable: false`; corrected to `true` when subspec 01's `repair_budget_exhausted` rule was withdrawn — see that subspec's Decisions.)
- [x] `v2/src/execution/workflow-runner-publication.test.ts` asserts `resumable` on the `runtime_smoke_failed` publication settlement. Adopting `readyFailureResumable` here reclassifies that kind `true` → `false`; the prior `true` was a known lie (`daemon-host.md` records that resume refuses smoke rows regardless), so the new value is correct, but it is a behavior change and is now pinned.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — intent and implement settlement producer contract.
- `v2/docs/v1-behaviors.md` — record the changed runner settlement evidence and retryability behavior.
