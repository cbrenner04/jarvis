# Mutation-repair attempt guards (HEAD, killing tests, timeout)

## Problem

Publication-time and resume-time `write.mutation-repair` iterations lack the reviewed guards from closed plan PR #4284: worktree drift vs the published tip, committing weakened killing tests, and leaving uncommitted edits after iteration timeout.

## Decision ledger

- Before each mutation-repair iteration (in-flow publication and resume), require worktree `HEAD` to equal the published tip SHA from the latest successful push-only or full publication on that repair tail; on mismatch settle without invoking repair (terminal `surviving_mutation_failed` on the write publication tail, or the existing resume settlement policy on review-mutation resume); rules out repairing against a diverged local branch while the remote/durable row still names an older published tip.
- HEAD mismatch before repair does not increment consumed mutation-repair attempts on the durable run; rules out charging drift skips against `MAX_MUTATION_REPAIR_ATTEMPTS` so operator realignment keeps the full remaining budget.
- After a repair agent pass, if the committed diff weakens or deletes a killing test that the active `SurvivingMutationError` named in `survivingMutationKillingTests`, revert that repair (discard the commit and uncommitted edits) and treat the attempt as failed for budget purposes; rules out persisting repair commits that remove the verifier's killing set.
- The shared mutation-repair driver (not `runMutationRepairIteration` alone) reverts uncommitted worktree edits whenever a repair attempt ends `unsettled` before settlement, on both publication in-flow and resume tails; rules out resume-only revert inside the iteration helper while publication settlement leaves a dirty tree.
- Apply guards in the shared mutation-repair driver introduced in `00-publication-inflow-mutation-repair-loop.md` so in-flow and resume paths stay aligned; rules out resume-only or publication-only guard forks.

## Task checklist

- Implement published-tip capture and per-iteration `HEAD` equality check on the shared repair driver entry.
- Implement post-repair killing-test regression detection against the active survivor's resolved killing set before push-only republication.
- Implement uncommitted-edit revert on `unsettled` repair iterations (reuse existing worktree snapshot/revert seams where possible).
- Add focused tests in `write-loop.test.ts` and/or `workflow-runner-resume-review-dispatch.test.ts` per acceptance criteria.

## Acceptance criteria

- [ ] `write-loop.test.ts` publication mutation-repair case: when worktree `HEAD` differs from the recorded published tip before a repair iteration, the harness settles without a `write.mutation-repair` `iteration_started` for that drifted state and durable mutation-repair attempt count stays unchanged so a subsequent `jarvis run resume` still has the full `MAX_MUTATION_REPAIR_ATTEMPTS` budget; fails pre-fix when drift is unreachable or when publication would still invoke repair against a locally advanced `HEAD` (no guard on main).
- [ ] `workflow-runner-resume-review-dispatch.test.ts` (or `write-loop.test.ts` shared-driver case): a repair iteration that deletes or neuters a named killing test does not retain a `Jarvis-Step: mutation-repair` commit on the branch; fails against the pre-fix path that commits repair output before reverification.
- [ ] `write-loop.test.ts` sibling test on the publication in-flow repair driver (extend `"mutation repair ignores bounded quiescence and joins a non-cooperative invocation"` only if it exercises that driver): after publication-time repair returns `unsettled`, `git status --porcelain` is empty at `surviving_mutation_failed` settlement; fails pre-fix when revert runs only inside `runMutationRepairIteration` and the publication tail leaves uncommitted repair edits.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — document HEAD-vs-published-tip gate, killing-test regression revert, and timeout dirty-tree revert on `write.mutation-repair` iterations (publication in-flow and resume).
- `v2/docs/operator-runbook.md` — note that local commits ahead of the published tip skip repair and settle resumable `surviving_mutation_failed`; operator fixes drift then resumes.
