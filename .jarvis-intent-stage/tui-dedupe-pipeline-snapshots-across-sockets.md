---
name: tui-dedupe-pipeline-snapshots-across-sockets
---

# TUI dedupes pipeline snapshots by pipelineId when merging across daemon sockets

Single module-boundary surface: `mergePipelineSnapshots` in `v2/src/tui/tui-monitor-lines.ts`. Every downstream consumer (tree rows, selectable node ids, attention projection, `v2/src/tui/tui-attention-rows.ts`) reads through that one function unchanged, so splitting does not apply.

## Prerequisites

## Problem

`mergePipelineSnapshots` concatenates the `pipelines` array of every discovered daemon socket with no dedup. During the normal transient two-daemon window (old daemon draining in-flight runs, new daemon admitting work, both over the same run store), both sockets return the same pipelines. Each pipeline renders twice with the *same* tree-node id, so selection highlights both copies and the duplicated ids in `monitorSelectableNodeIds` trap `j`/`k` in a cycle. Observed 2026-08-10: 21 pipelines rendered as 42 rows, navigation stuck on the top pair. `mergeRunLists` (`v2/src/daemon/merge-run-lists.ts`) already dedupes runs by `runId`; snapshot merging must mirror that.

## Decisions

- `mergePipelineSnapshots` dedupes by `pipelineId`, one snapshot per id — rules out concatenation that double-counts a pipeline served by two sockets.
- On collision, prefer the more-advanced snapshot by a deterministic documented rule (finished beats unfinished via `finishedAtMs`, then greater settled-stage count, then sorted socket-path order as the final tiebreak) — rules out first-encounter-wins, which is stale and nondeterministic while two daemons momentarily disagree.
- Scope stays inside the merge function; tree builder, selectable-node computation, and attention projection consume the deduped list unchanged — rules out patching duplication downstream in tree/selection code.
- Iteration order remains sorted socket-path order, first-appearance position per id — rules out a reorder that churns unrelated row-ordering tests.

## Acceptance criteria

- [ ] `mergePipelineSnapshots` returns one snapshot per `pipelineId` when the same pipeline appears under two socket keys; a regression in `v2/src/tui/tui-monitor-lines.test.ts` feeds two socket entries with an overlapping pipeline and asserts a single merged entry, failing against the current concatenation.
- [ ] With two sockets serving an identical pipeline set, `monitorLeftPaneTreeRows` and `monitorSelectableNodeIds` contain no duplicate node ids; a regression pins this.
- [ ] Distinct pipelines from different sockets are all retained and their sorted-socket-path order preserved; a regression pins the mixed case.
- [ ] The collision preference rule is deterministic and pinned by a test where the two snapshots for one id differ in progress; swapping socket insertion order yields the same winner.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — note that the TUI dedupes pipeline snapshots by id across discovered sockets, so a transient multi-daemon window no longer duplicates pipeline rows.
