# Stale reset gates disposable-lane retirement and unlanded work

- [x] [00 - Reset stale workspace disposable-lane gates](./00-reset-stale-workspace-disposable-lane-gates.md)
- [x] [01 - Pipeline execution disposable-lane stale-reset cross-link](./01-pipeline-execution-disposable-lane-stale-reset.md)
- [x] [02 - v1-behaviors stale-reset disposable-lane gates](./02-v1-behaviors-stale-reset-disposable-lane-gates.md)

Scope: extend shared `resetStaleWorkspace` with a path-scoped unlanded-commits-with-no-PR refusal (tip SHA, commit count, hand-finish salvage path) and a caller-supplied disposable-lane marker that bypasses descendant and landed-criteria refusals only; live-held, dirty reuse outside harness draft dirt, and ready-PR refusals stay unconditional; `jarvis cleanup` merged-worktree retirement and standalone `run workflow` incomplete re-run defaults stay unchanged; pipeline restart caller wiring, structural disposable validation, and the full operator contract land in [[pipeline-restart-discards-disposable-stage-state]].
