# Recover the durable review mutation tail

`resolveReviewRowHead` searches `(project, branch, authored write stepId)`, but linked
implement runs persist completed write rows as `implement~link-*`. A review-owned
`surviving_mutation_failed` row therefore loses its usable sibling and is projected
non-resumable before `resumeReviewMutationFinalization` can run.

## Decisions

- Define one review-tail admission resolver for resume dispatch and `list` / `wait` projection. A newly emitted terminal `loop_finished` reflects that resolver's retryability; immutable historical records are never rewritten, so a stale `resumable: true` record whose current reconstruction rejects admission projects `resumable: false` with `unsupported_resume_context`.
- Support only failed, persisted durable review rows: a durable `review-debate` row (including the implement workflow's debate `implement-review`) or a durable landing-bearing `review` row. A non-durable light `implement-review` is not a recovery target merely because it has that step ID.
- Resolve the completed write sibling from the exact workflow `invocationId`: candidates are completed durable rows for the authored write step or its `~link-*` executions. Select the terminal linked pass by completed-boundary order with a stable row-ID tie-breaker; reject missing, incomplete, cross-invocation, conflicting-context, or otherwise ambiguous candidates. A selected write row may also be the workflow entry row, but that does not make its ID resumable.
- Take `worktreePath`, `baseRef`, and `specPath` from the selected write row; take completion attribution from its completed boundary, then its snapshot write-agent fallback; take publication shape from that write step's `expectedArtifactPath`; and take `invocationId` / creation-title hint from the shared snapshot. Review-row verdict, staging, and ref fields never override those sources.
- Admit `surviving_mutation_failed` and the retryable `completion_commit_failed` / `ready_gate_failed` outcomes produced by this tail. Exclude `landing_failed`, `runtime_smoke_failed`, `ready_flip_failed`, generic invocation failures, completed rows, entry rows, and `~shrink` rows.
- An admitted retry records one owning-row attempt, commits surviving operator changes when needed, re-verifies mutations, runs the ready gate, then publishes. Each retry repeats that tail from its appropriate checkpoint; it never invokes a write or review agent, replays a workflow, or creates a write-row attempt. Rejected admission creates no attempt and calls no committer, finalizer, publisher, or agent.
- Keep populated-intent `landing_failed` recovery on its existing resolver and behavior; this sibling-resolution change must not broaden or redirect it.

## Tasks

- Replace authored-step-only review-tail sibling lookup with deterministic invocation-scoped completed-write resolution, including linked `~link-*` rows and fail-closed context validation.
- Route resume admission, direct-row `list`, direct-row `wait`, and newly emitted review-tail terminal records through the same admission result; preserve historical JSONL while projecting rejected historical records as unsupported.
- Reconstruct finalization solely from the selected write row and shared snapshot, and keep populated-intent `landing_failed` on its existing path.
- Exercise reopen-safe durable state and log reads, repeat retries, every rejected shape, and rejection before side effects.
- Align the durable operator, daemon, and v1-behavior contracts.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner.test.ts`'s `resuming a review row's surviving_mutation_failed actually re-runs the ready finalizer (mutation reverification)` uses a completed `implement~link-*` sibling plus conflicting review-shaped context fields; it fails against the baseline and passes only when write-row/snapshot precedence drives mutation re-verification.
- [ ] Conflicting review-row base ref, spec path, worktree, completion-agent, and artifact-shape fields cannot affect the selected sibling's finalizer, committer, attribution, or publisher input; write-row and shared-snapshot precedence supplies each value.
- [ ] A failed durable debate `implement-review` row and a failed durable landing-bearing `review` row with `surviving_mutation_failed` resume the same owning row through commit-if-dirty, mutation re-verification, ready gate, and publication; a non-durable light `implement-review` does not.
- [ ] After a `completion_commit_failed`, `ready_gate_failed`, or repeated `surviving_mutation_failed` from that tail, the owning durable review row remains retryable and a subsequent resume restarts only the required commit/finalization/publication tail; `landing_failed`, `runtime_smoke_failed`, `ready_flip_failed`, generic invocation failure, and completed rows refuse it.
- [ ] Each admitted review-tail resume records no write-row attempt and invokes no write-step or review agent.
- [ ] For an admitted owning row, its terminal `loop_finished`, direct `list`, direct `wait`, and resume admission all report resumable. For each rejected owning row, all three projections report non-resumable / `unsupported_resume_context` and resume returns `resume_unsupported`, even when its immutable pre-fix terminal record says `resumable: true`.
- [ ] Closing and reopening the state store and log reader before `list`, `wait`, and resume preserves the same positive and negative admission results without adding persisted fields.
- [ ] Missing, incomplete, wrong-invocation, conflicting, or ambiguous write-sibling candidates reject before attempt creation and invoke neither committer, ready finalizer, publisher, nor agent; tests fail when each added or modified admission guard is inverted.
- [ ] A completed linked write sibling can supply context when it is also the workflow entry row, but the workflow entry ID and a completed `~shrink` row report non-resumable from `list` and `wait` and refuse the review-owned recovery in `v2/src/daemon/daemon-resume.test.ts`.
- [ ] `v2/src/daemon/daemon-resume.test.ts`'s `resumes a populated-stage intent finalization end to end: landing_failed projects resumable, completed after republication` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust and § Publication / completion failures — document eligible durable review shapes, same-invocation completed-write-sibling admission, agent-free retry order, repeat outcomes, and refusal cases.
- `v2/docs/daemon-host.md` — document linked-write-aware admission, authoritative reconstruction sources, entry-row refusal, and shared resume / list / wait projection including stale immutable terminal records.
- `v2/docs/v1-behaviors.md` — replace the authored-write-row recovery claim with the corrected durable review-row contract and its excluded outcomes.
