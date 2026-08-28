# Branch-Aware Stage Run Attribution

repo: cbrenner04/jarvis

- [x] [00 - A run on a stage's branch nests under that stage instead of doubling as an ad-hoc row](./00-branch-aware-stage-attribution.md)

Scope note: one module-boundary surface — the TUI unified-tree projection in `v2/src/tui/tui-monitor-pipeline-tree.ts`. Every consumer (`tui-attention-rows.ts`, `tui-monitor-lines.ts`, `tui-entry.tsx`) reads its attribution through `buildMonitorPipelineTreeJoin`, so the fix lands in one place and propagates; no daemon, persistence, wire, or CLI change is implied. The run rows already carry `branch` and the stage records already carry `workflowInvocationId`, so the stage's git branch is derivable from existing fields. Why the duplicate invocation exists at all (the `f900c104` row on the observed `full-review` pipeline) is a separate daemon-side question and stays out of this tree.
