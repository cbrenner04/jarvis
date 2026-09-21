# 00 — `branch_not_resumable` detail carries the blocking stage id

## Problem

`scanBranchSuffixForAdmission` (`v2/src/daemon/pipeline-execution.ts`) returns `not_resumable` with only `status`; the refusal detail cannot name which row blocked.

## Decisions

- `not_resumable` scan result and `branch_not_resumable` detail gain `stageId` of the first unsatisfied row; ruled out: naming the branch's last row or omitting on success-path.
- The all-satisfied fallthrough (no blocking row) keeps `status: "succeeded"` and omits `stageId`; ruled out: inventing a stage id.

## Acceptance criteria

- [ ] A test in `v2/src/daemon/pipeline-execution.test.ts` asserts a `branch_not_resumable` refusal (e.g. the terminal-skipped successor case) carries the blocking row's `stageId` and `status`; it fails against the pre-fix detail.
- [ ] A test drives the all-satisfied fallthrough through the public `resumePipeline` (a branch whose rows have all `succeeded`) and asserts the refusal carries `status: "succeeded"` and no `stageId`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` (~line 782) — `branch_not_resumable` carries the blocking `stageId` when one exists, alongside the branch's current stage status.
- `v2/docs/v1-behaviors.md` (~line 320) — `branch_not_resumable` carries the blocking row's `stageId` when there is one, alongside its status.
