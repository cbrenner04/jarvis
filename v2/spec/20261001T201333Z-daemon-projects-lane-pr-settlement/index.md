# Daemon list, wait, pipeline, and notifications report lane PR settlement

Runs and stages that already settle on `lane_pr_closed` or `lane_pr_merged` still project as generic publication failures or omit the lane outcome and PR number on `run list`/`run wait`, pipeline snapshots, and operator notifications.

Settlement prerequisites are landed in [lane-pr-outcomes-settle-runs-and-stages](../v2/spec/20261001T145917Z-lane-pr-outcomes-settle-runs-and-stages/index.md) and [lane-pr-history-blocks-republish](../v2/spec/completed/20261001T010442Z-lane-pr-history-blocks-republish/index.md); this spec owns daemon projection and notification derivation only.

Intent acceptance criteria in `intent.md` are satisfied when every automated acceptance criterion in subspecs 00–02 passes (same test files and behaviors as those subspecs, not undifferentiated rollups such as bare `run.test.ts`).

Documentation: subspec 02 owns full `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` closure for this spec; subspecs 00 and 01 land runtime behavior without duplicate doc edits until 02 merges.

- [x] [00 — Run list/wait lane PR operator error](./00-run-list-wait-lane-pr-operator-error.md)
- [x] [01 — Operator notification lane PR incidents](./01-operator-notification-lane-pr-incidents.md)
- [ ] [02 — Pipeline list/wait lane PR stage observation](./02-pipeline-list-wait-lane-pr-stage-observation.md)
