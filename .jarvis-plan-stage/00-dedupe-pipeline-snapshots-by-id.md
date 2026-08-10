# 00 - Dedupe merged pipeline snapshots by pipelineId

## Problem

`mergePipelineSnapshots` (`v2/src/tui/tui-monitor-lines.ts:469`) concatenates every discovered socket's `pipelines` array with no dedup. During the transient two-daemon window (old daemon draining, new daemon admitting, same run store) both sockets return the same pipelines, so each pipeline paints twice under the *same* tree-node id: 21 pipelines rendered as 42 rows on 2026-08-10, and the duplicated ids in `monitorSelectableNodeIds` trapped `j`/`k` on the top pair. `mergeRunLists` (`v2/src/daemon/merge-run-lists.ts`) already dedupes runs by `runId`; snapshot merging must mirror that.

## Decisions

- Dedupe inside `mergePipelineSnapshots` only; tree builder, `monitorSelectableNodeIds`, and `buildAttentionRows` consume the deduped list unchanged — rules out patching duplication downstream in tree/selection code.
- Key is `pipelineId`, one snapshot per id — rules out concatenation that double-counts a pipeline served by two sockets.
- Collision winner is deterministic: finished (`finishedAtMs !== null`) beats unfinished; then greater count of stages with non-null `endedAt`; then earlier sorted socket path — rules out first-encounter-wins, which is stale and nondeterministic while two daemons momentarily disagree.
- `endedAt` is the stage-terminal marker already read by `pipelineStageRollupRow`/`stageDetailRows` — rules out inventing a separate progress field.
- Emission order is sorted socket-path iteration, each id at its first-appearance position even when a later socket's snapshot wins (`Map.set` on an existing key keeps insertion order) — rules out a reorder that churns unrelated row-ordering tests.

## Task checklist

- [ ] Rewrite `mergePipelineSnapshots` as a `Map<string, PipelineSnapshot>` keyed by `pipelineId` with the preference rule above.
- [ ] Add regressions to `v2/src/tui/tui-monitor-lines.test.ts` covering merge dedup, node-id uniqueness across `monitorLeftPaneTreeRows`/`monitorSelectableNodeIds`, mixed distinct pipelines, and the order-independent collision winner.
- [ ] Update `v2/docs/operator-runbook.md` § Observe.
- [ ] `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] Two socket entries whose `pipelines` overlap on one `pipelineId` merge to a single snapshot for that id; the regression fails against the current concatenation. `v2/src/tui/tui-monitor-lines.test.ts` — `merging two sockets serving the same pipeline yields one snapshot per pipelineId`; Keystone checkpoint: reverting the merge return to sorted-socket-path concatenation leaves the duplicate visible and turns this test RED.
- [ ] With two sockets serving an identical pipeline set, `monitorLeftPaneTreeRows` and `monitorSelectableNodeIds` contain no duplicate node ids. `v2/src/tui/tui-monitor-lines.test.ts` — `two sockets serving an identical pipeline set paint no duplicate node ids`; the test fails against the pre-fix code.
- [ ] Pipelines unique to each socket are all retained, in sorted socket-path order. `v2/src/tui/tui-monitor-lines.test.ts` — `distinct pipelines from both sockets survive in sorted socket-path order`.
- [ ] For one id whose two snapshots differ in progress, the more-advanced snapshot wins and swapping which socket path carries it yields the same winner. `v2/src/tui/tui-monitor-lines.test.ts` — `the more-advanced snapshot wins a collision regardless of socket order`; Mutation checkpoint: collapsing the collision guard to first-encounter-wins, and to unconditional last-wins, each turn this test RED.
- [ ] `v2/src/tui/tui-attention-rows.test.ts` and the existing `v2/src/tui/tui-monitor-lines.test.ts` single-socket row/order tests stay green (merge behavior unchanged for one socket).
- [ ] `v2/docs/operator-runbook.md` § Observe states that the TUI dedupes pipeline snapshots by id across discovered sockets, so a transient multi-daemon window no longer duplicates pipeline rows.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — one sentence: pipeline snapshots merge deduped by id across discovered sockets (more-advanced snapshot wins), so a transient two-daemon window paints each pipeline once.
