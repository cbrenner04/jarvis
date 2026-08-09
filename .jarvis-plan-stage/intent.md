---
name: terminal-timestamps-on-daemon-wire
---

# Terminal timestamps on the daemon observation wire

## Problem

Terminal runs and stages can reach the wire with no finish time. `list` omits `finishedAtMs` whenever `runListTerminalFinishAtMs` finds no attempt `completed_at` and no `reconciledAt`, so a failed run reads as unfinished — observed as a dead run's elapsed advancing 46m→49m across refreshes, and as FIFO/sort logic treating it as unfinishable. On the pipeline side the settle paths in `pipeline-stage-dispatch.ts` and `pipeline-execution.ts` are not enumerated anywhere, so nothing pins that each terminal write carries `endedAt`; `settleUnexpectedThrow`'s failed-before-start shape (terminal, `endedAt` set, `startedAt` null) is likewise unpinned. `pipeline_list` projects no approval decision timestamp.

## Decisions

- A run with terminal status always reports non-null `finishedAtMs` on `list`, sourced from the durable finish timestamp — rules out consumers guessing and rules out a read-time fallback at the projection.
- A terminal stage with null `startedAt` is a legitimate "failed before start" state; the wire keeps `startedAt` null — rules out inventing a start so elapsed renders.
- The settle-path guarantee is pinned by a test that enumerates the settle paths and asserts each — rules out spot-checking the known-good ones.
- No TUI rendering changes here; work/idle aggregation and frozen elapsed ride later seeds.

## Acceptance criteria

- [ ] A run driven to `failed` without a completion boundary reports non-null `finishedAtMs` on daemon `list`; a `daemon-start-list.test.ts` test naming that shape fails against the pre-fix code.
- [ ] `finishedAtMs` is non-null for every terminal run status on `list`, not only `failed`.
- [ ] Every stage-settle path in `pipeline-stage-dispatch.ts` and `pipeline-execution.ts` that writes a terminal status writes `endedAt`; a `pipeline-stage-dispatch.test.ts` test enumerates those paths and pins each, and fails against the `patch: { status: "skipped" }` write `skipRemainingStages` issues on the pre-fix code.
- [ ] `settleUnexpectedThrow`'s output is pinned as the failed-before-start shape: terminal status, `endedAt` set, `startedAt` null, and `pipeline_list` projects `startedAt` as null rather than synthesizing one.
- [ ] Approving or rejecting a gate leaves `decidedAt` on that approval stage row, and `pipeline_list` projects it; a `daemon-pipeline-observation.test.ts` test fails against the pre-fix code.
- [ ] Mutation checkpoint: in `daemon-start-list.test.ts` test `a failed run with no completion boundary still reports finishedAtMs`, a `// @mutate` directive neutering the terminal-run finish source turns that regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § RPC table `list` row — `finishedAtMs` is non-null for every terminal status and no longer omitted when attempts carry none.
- `v2/docs/daemon-host.md` § RPC table `pipeline_list` row — approval `decidedAt` on the projected stage shape; `startedAt` stays null on a stage that failed before start.
- `v2/docs/daemon-host.md` § Pipeline stage dispatch — every settle path writes `endedAt`; the failed-before-start shape.
- `v2/docs/v1-behaviors.md` — record that `list` now always reports `finishedAtMs` for terminal runs and `pipeline_list` now projects approval `decidedAt`.

## Prerequisites

- Predecessor: `terminal-timestamp-persistence` (landed): the state store records run finish, terminal-stage `endedAt`, and approval `decidedAt`.
- Every durable transition to a terminal run status records a run finish timestamp.
- Every durable stage write landing a terminal status persists `endedAt`, including `skipped`.
- Approval decisions persist `decidedAt` on the stage row and it is exposed on loaded stage records.
- `runListTerminalFinishAtMs` derives list `finishedAtMs` for terminal statuses only, and the field is omitted when no source carries a finish time.
- `projectPipelineSnapshot` projects durable pipeline and stage rows onto `pipeline_list` without following live transitions.
- `derivePipelineFinishedAtMs` takes `terminalPublicationSucceededAt` when set, otherwise the maximum non-null stage `endedAt`, otherwise `createdAt`.
- `dispatchPipelineStage` settles a stage through the dispatch-refusal write, `applyEntryRunSettlement`, and `settleUnexpectedThrow`; `pipeline-execution.ts` settles through `failWorkflowStageAt`, `settleApprovalBoundaryFailure`, and `skipRemainingStages`.
- `settleUnexpectedThrow` writes `status: "failed"` and `endedAt` for a throw before entry-run admission and never writes `startedAt`.
