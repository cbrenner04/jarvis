# Pipeline external chained resolution and fan-out lane failure incidents

Chained plan stages reject externally landed ready-intents because `locateAbsentWorktreeDownstreamInputReadRoot` still gates on `gitPathExistsOnBranch`. Fan-out lanes that settle `failed` while siblings keep the pipeline non-terminal emit no operator incident naming their `branchKey` (#3374).

Ordered: `00` external ready-intent chained resolution; `01` fan-out lane failure incidents; `02`–`04` document operator and architecture prose.

- [ ] [00 - External ready-intent chained resolution](./00-external-ready-intent-chained-resolution.md)
- [x] [01 - Fan-out lane failure incidents](./01-fan-out-lane-failure-incidents.md)
- [x] [02 - Document daemon-host chained resolution](./02-document-daemon-host-chained-resolution.md)
- [ ] [03 - Document operator-runbook chained resolution](./03-document-operator-runbook-chained-resolution.md)
- [ ] [04 - Document v1-behaviors chained resolution](./04-document-v1-behaviors-chained-resolution.md)
