---
name: pipeline-terminal-timestamps
---

# Pipeline terminal timestamps — close the gaps that make TUI time lie

First seed of the TUI command-center phase ([tui-command-center-brief.md](../tui-command-center-brief.md)). Data-side only: display changes (work/idle aggregation, frozen elapsed) ride later seeds.

## Problem

Dogfooding surfaced three timestamp gaps. (1) A pipeline stage that fails before entry-run admission (`settleUnexpectedThrow`) gets `status=failed` + `endedAt` but no `startedAt`, so its elapsed renders blank — observed on failed `implement` stages. (2) Failed runs can report `finishedAtMs === null` on daemon `list`, so TUI rows tick wall-clock forever after death (observed: a failed run's elapsed advancing 46m→49m across refreshes) and FIFO/sort logic treats them as unfinishable. (3) Approval stage records carry no decision timestamp, so gate wait and idle time are not derivable from the wire.

## Decisions

- Invariant: a run with terminal status always reports non-null `finishedAtMs` on daemon `list` — locate and close the failed-run finishless path (run settlement or list projection) rather than patching the display. Rules out consumers guessing.
- Invariant: a stage record with terminal status always has `endedAt` (audit all settle paths, not just the known-good ones).
- A terminal stage with null `startedAt` is a legitimate state meaning "failed before start"; the wire keeps `startedAt` null rather than inventing one. Rules out fake timestamps.
- Approval stage records persist `decidedAt` when approved/rejected, and `pipeline_list` projects it. Awaiting-since needs no new column — consumers derive it from the predecessor stage's `endedAt`.
- No TUI rendering changes in this seed.

## Acceptance criteria

- [ ] A run driven to `failed` reports non-null `finishedAtMs` on daemon `list`.
- [ ] Every stage-settle path that writes a terminal status writes `endedAt`; a test enumerates the settle paths and pins each.
- [ ] `settleUnexpectedThrow` output (terminal, `endedAt` set, `startedAt` null) is pinned as the failed-before-start shape.
- [ ] Approving or rejecting a gate persists `decidedAt` on the approval stage record and `pipeline_list` projects it.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Pipeline — approval `decidedAt` on the observation wire; failed-before-start stage shape.

## Prerequisites

- `v2/src/daemon/pipeline-stage-dispatch.ts` — `settleUnexpectedThrow`, `applyEntryRunSettlement`
- `v2/src/daemon/pipeline-execution.ts` — approval resolution (`resolveApproval` seam)
- `v2/src/daemon/pipeline-observation.ts` — `projectPipelineSnapshot`
- `v2/src/persistence/state-store.ts` — stage/approval records; run terminal rollup
