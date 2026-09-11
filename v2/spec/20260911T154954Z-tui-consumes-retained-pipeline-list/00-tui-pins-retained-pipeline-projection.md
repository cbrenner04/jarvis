# TUI pipeline surfaces stay on the daemon's retained projection

## Problem

`pipeline_list` now caps terminal pipelines at the 50 newest unless the caller passes `sinceMs`/`state`. Nothing pins the TUI to that default projection: a future change could add a history query or an accumulating per-socket snapshot merge, re-expanding the work tree, work counts, and pipeline-sourced attention past what `jarvis pipeline list` shows.

## Decisions

- This is a preservation/pinning subspec: no production change is expected. The poll already sends only `includeDismissed` (`v2/src/tui/tui-entry.tsx:685-688`) and assigns each socket's retained result wholesale (`v2/src/tui/tui-entry.tsx:689`); `v2/src/tui/tui-entry.test.tsx` already asserts exact `pipelineListRequests` shapes and already exercises snapshot shrinkage across a refresh. Rules out inventing a TUI-side filter or a "fix" for a defect that is not reachable on the base.
- The primary-socket eviction path (`tui-entry.tsx:659-662` carries the prior snapshot forward while `clients.has` is still true; the `list()` failure branch at `677-680` then closes and deletes that socket and `continue`s past `pipelineList`) lets a dropped primary socket's last-observed pipeline snapshot survive one extra tick. This is the existing "preserve stale-last-good behavior for transient RPC failure" decision, not a defect, so it gets no regression test.
- Drive the model tests through the pure builders over a fixture, not through an Ink render; rules out coupling retention coverage to layout.
- Leave `v2/src/tui/tui-attention-rows.ts` recency and always-visible gate rules untouched; retention limits its input upstream.

## Task checklist

- [ ] Cite the existing `pipelineListRequests` param assertions in `v2/src/tui/tui-entry.test.tsx` (both dismissed-toggle states) as the polling pin.
- [ ] Add a work-tree model test proving the model renders exactly the pipelines in a given result set, with no independent TUI-side cap or age filter.
- [ ] Add an attention-model test proving a pipeline absent from the result set contributes no row.
- [ ] Cite the existing snapshot-replacement tests in `v2/src/tui/tui-entry.test.tsx` and add one assertion covering descendants, counts, and attention across a refresh to a strictly smaller set.

## Acceptance criteria

- [ ] `v2/src/tui/tui-entry.test.tsx`'s existing `pipelineListRequests` assertions (dismissed-toggle on and off) stay green, pinning that the poll requests `pipeline_list` with only `includeDismissed` and no `sinceMs`/`state` key.
- [ ] A work-tree model test proves the model renders every pipeline present in a given `pipeline_list` result — terminal and non-terminal alike — with no independent TUI-side cap or age filter beyond what it was given.
- [ ] An attention-model test proves a terminal pipeline absent from a given result set contributes no gate, stage-failure, or publication-failure row, while pipelines present in the result keep their existing attention rows.
- [ ] `v2/src/tui/tui-entry.test.tsx`'s existing snapshot-replacement tests ("a selected pipeline that leaves the snapshot clears the selection", "when a refresh drops the selected id from the selectable list, selectedNodeId clears") stay green, and a new assertion in that suite shows a successful refresh returning a strictly smaller pipeline set also drops the removed pipelines' descendants, work counts, and attention rows.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- None; this subspec adds pinning tests only and changes no operator-facing behavior. Docs land in `01-document-shared-pipeline-retention.md`.
