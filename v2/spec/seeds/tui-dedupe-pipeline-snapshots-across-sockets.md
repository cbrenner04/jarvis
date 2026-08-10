---
name: tui-dedupe-pipeline-snapshots-across-sockets
---

# TUI must dedupe pipeline snapshots by pipelineId when merging across daemon sockets

## Problem

`mergePipelineSnapshots` (`v2/src/tui/tui-monitor-lines.ts`) concatenates the `pipelines` arrays from every discovered daemon socket with no dedup. When more than one live daemon is present — the normal transient state during a re-key drain, where an old daemon still owns in-flight runs while a new one is admitting work, both reading the same run store — the TUI discovers both sockets and each returns the same pipelines. Every pipeline then renders twice, with the *same* tree-node id on both copies. Because selection highlights by node id, selecting one duplicate highlights both, and the duplicated ids in `monitorSelectableNodeIds` trap `j`/`k` navigation in a cycle. Observed 2026-08-10 with two live daemons (`daemon-c9af…`, `daemon-fdfe…`): `jarvis tui` showed each of 21 pipelines twice (42 rows) and navigation could only reach the top duplicated pair.

The run side already handles this correctly: `mergeRunLists` (`v2/src/daemon/merge-run-lists.ts`) dedupes by `runId` (Map keyed by run id, preferring the live row). Pipeline-snapshot merging must mirror that.

## Decisions

- `mergePipelineSnapshots` dedupes by `pipelineId` across sockets, keeping one snapshot per id — rules out concatenation that double-counts a pipeline served by two sockets.
- When the same `pipelineId` appears on multiple sockets, prefer the more-advanced/most-recent snapshot deterministically (e.g. the invoking socket, or the one with the later `finishedAtMs`/greater settled-stage count), not first-encounter — rules out a nondeterministic or stale pick when two daemons momentarily disagree. Keep it deterministic and documented; simplest defensible rule is fine.
- Scope to snapshot merging; the tree builder, selectable-node computation, and attention projection consume the deduped list unchanged — rules out patching duplication downstream in the tree/selection code.

## Acceptance criteria

- [ ] `mergePipelineSnapshots` returns one snapshot per `pipelineId` when the same pipeline appears under two socket keys; a new `v2/src/tui/tui-monitor-lines.test.ts` regression feeds two socket entries with an overlapping pipeline and asserts a single merged entry, failing against the current concatenation.
- [ ] With two sockets serving an identical pipeline set, `monitorLeftPaneTreeRows` and `monitorSelectableNodeIds` contain no duplicate node ids; a regression pins this.
- [ ] Distinct pipelines from different sockets are all retained (no over-dedup); a regression pins the mixed case.
- [ ] The multi-socket preference rule is deterministic and pinned by a test where the two snapshots for one id differ.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — note that the TUI dedupes pipeline snapshots by id across discovered sockets, so a transient multi-daemon window no longer duplicates pipeline rows.
