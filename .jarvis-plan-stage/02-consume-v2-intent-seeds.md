# Consume v2 Intent Seeds

## Scope

Carry v2 file-seed origins through intent workflows and consume them only when durable ready-intent publication succeeds.

## Decisions

- Record file origins when the builder reads them, not by re-reading CLI paths at completion; rules out consuming a changed input.
- Persist the complete origin collection through workflow snapshot/resume; rules out first-input-only cleanup after retry or batching.
- Put git-backed deletion beside landed output before the completion commit; rules out a separate deletion commit or uncommitted mutation.
- Delete non-git seeds only after all durable landing succeeds; rules out consumption on staging, review, collision, or partial landing failure.
- Reuse real-path-safe source/worktree validation; rules out missing, external, or symlink-escaped deletion.
- Leave inline seeds artifact-free; rules out inferring a queue file from seed text.

## Work

- Thread file-backed input ownership through v2 intent builders, workflow snapshots/resume, landing, completion commit, and non-git completion.
- Cover split-only and reviewed intent variants without changing output landing or publication retry contracts.
- Align the v2 workflow and operator durable docs with the seed queue lifecycle.

## Acceptance criteria

- [ ] Successful v2 intent publication consumes every file seed read after every emitted ready-intent is durable; inline seed text creates no deletion.
- [ ] Git-backed deletion is included in the intent completion commit; failed landing or publication leaves the source queue intact and retryable.
- [ ] Non-git collision, validation, review, partial landing, or filesystem failure preserves every seed.
- [ ] Missing, external, and symlink-escaped mapped targets remain undeleted after source-side and publication-worktree real-path checks.
- [ ] Workflow snapshot/resume preserves the complete recorded input set, so retried and batched promotion consumes every file actually read.
- [ ] `v2/src/execution/publication-workflow-steps.test.ts`, `v2/src/execution/publication-landing.test.ts`, and `v2/src/execution/workflow-runner.test.ts` add pre-fix-failing intent coverage for git, non-git, failure, fan-out/all-recorded-input, inline, unsafe-target, and resume cases.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/first-workflow-walkthrough.md`, and `v2/docs/operator-runbook.md` document seeds as open work, with `write-behavior.md` authoritative for consumption and retry semantics.
