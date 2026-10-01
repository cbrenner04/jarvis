# Lane PR history outcomes settle runs and pipeline stages

Resume and pipeline recovery still treat operator-closed or merged lane PRs as publication failures or drive duplicate republication even when completion publication already returned `lanePrOutcome` or a permanent list-probe failure.

Prerequisites (publication boundary) are landed in [lane-pr-history-blocks-republish](../completed/20261001T010442Z-lane-pr-history-blocks-republish/index.md); this spec wires durable run and linked-stage settlement to those outcomes.

- [ ] [00 — Workflow-runner lane PR run settlement](./00-workflow-runner-lane-pr-run-settlement.md)
- [ ] [01 — Pipeline linked-stage lane PR settlement](./01-pipeline-linked-stage-lane-pr-settlement.md)
