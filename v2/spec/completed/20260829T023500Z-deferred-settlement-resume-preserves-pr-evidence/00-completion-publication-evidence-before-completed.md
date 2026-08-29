# Completion publication persists PR evidence before terminal run visibility

## Problem

Successful completion publication in the execution loop writes durable `completed` before `setPrEvidence` on both the fresh write-loop tail and the completed-run resume tail (`v2/src/execution/write-loop.ts`). Workflow-owned publication tails that call `publishWithReadyRepair` then mark the row `completed` through `setRunStatus` or `commitCompletionBoundary` without persisting PR evidence first (`v2/src/execution/workflow-runner.ts`). A pipeline settlement observer that reads the entry run as soon as rollup reports `completed` can settle a deferred stage while `prNumber`/`prUrl` are still absent — reachable today on the status-before-evidence ordering in `write-loop.ts` lines ~1016–1022 and ~1886–1892.

## Surface

Execution loop: completion-publication success tails in `write-loop.ts` and `workflow-runner.ts` that make a run durably `completed`. Out of scope: daemon stage settlement, terminal publication admission, and changing publication-failure or no-content completion semantics.

## Decision ledger

- Every successful publication tail calls `setPrEvidence` with the confirmed `prNumber`/`prUrl` pair before the first durable `completed` write on that tail (`setRunStatus` or `commitCompletionBoundary`); rules out observers racing a later evidence write. Workflow tails that already return PR fields only in the in-memory result must persist through `setPrEvidence` (or `commitCompletionBoundary`'s `beforeRunUpdate`) on the same ordering contract.
- When publication success carries no complete PR pair, terminal visibility stays on today's failure or no-publish paths — rules out marking `completed` solely to expose partial evidence.
- A crash after evidence but before `completed` may leave a non-terminal run carrying reusable PR evidence; idempotent publication resume already owns recovery — rules out a new multi-state persistence transaction.
- General no-content / empty-branch completion semantics stay unchanged — rules out forcing empty branches to publish for pipeline settlement.

## Task checklist

- [ ] Reorder the fresh successful publication block in `write-loop.ts` so `setPrEvidence` runs before `setRunStatus(..., "completed")` when both `publication.success.prNumber` and `publication.success.prUrl` are present.
- [ ] Apply the same ordering on the completed-run resume publication block in `write-loop.ts`.
- [ ] On every workflow-owned successful publication tail that currently marks `completed` without `setPrEvidence`, persist the confirmed pair through `setPrEvidence` (or `commitCompletionBoundary({ beforeRunUpdate })`) before the boundary commits `completed`.
- [ ] Add fresh and resumed ordering regressions in `write-loop.test.ts`; keep existing publication-failure and resume-replay coverage green.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` test `fresh completion publication persists PR evidence before the run becomes completed` proves that on a successful fresh publication the run already carries both `prNumber` and `prUrl` at its first durable `completed` write; it fails against the pre-fix status-before-evidence ordering in `write-loop.ts`.
- [x] `v2/src/execution/write-loop.test.ts` test `resumed completion publication persists PR evidence before the run becomes completed and reuses the published PR` proves the same evidence-before-`completed` ordering on a resumed publication and that the resumed tail publishes no second PR; it fails against the pre-fix resume block that becomes `completed` before the evidence write.
- [x] `v2/src/execution/write-loop.test.ts` — `fresh completion publication persists PR evidence before the run becomes completed`; Keystone checkpoint: the test body carries `// @mutate v2/src/execution/write-loop.ts "store.setPrEvidence(runId, publication.success.prNumber, publication.success.prUrl);" -> "void publication.success;"` — dropping the fresh-tail evidence write — and the test turns RED when applied.
- [x] `v2/src/execution/write-loop.test.ts` — `resumed completion publication persists PR evidence before the run becomes completed and reuses the published PR`; Mutation checkpoint: the test body carries `// @mutate v2/src/execution/write-loop.ts "store.setPrEvidence(prepared.result.runId, publication.success.prNumber, publication.success.prUrl);" -> "void publication.success;"` on the resumed successful-publication path and turns RED when applied.
- [x] `write-loop.test.ts` test `completed-run resume replays publication after a prior publication failure` stays green (publication failures remain named, resumable failures and never become `completed` merely to expose partial PR evidence).
- [x] `v2/docs/write-behavior.md` records that successful completion publication persists confirmed PR evidence before the run becomes durably `completed` on fresh and resumed tails.
- [x] `v2/docs/v1-behaviors.md` records the completion-publication evidence-before-`completed` ordering for v2.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — successful publication persists PR evidence before terminal run visibility on fresh and resumed tails.
- `v2/docs/v1-behaviors.md` — record the changed completion-publication ordering.
