---
name: workflow-wedged-run-killable
---

# Wedged workflow runs are killable and agree with list liveness

A workflow-started run that `jarvis run list` reports as non-terminal and live must accept `jarvis run kill` and reach durable status `killed` with worktree retained. `run_not_active` for a run `list` shows as `in-progress`/`live` is incoherent — list liveness and the kill registry must agree.

Healthy in-flight workflow runs may remain non-pausable; wedged runs must still be reapable.

## Decisions

- Kill wedged workflow runs by the same `runId` `list` shows — rules out requiring a different id or only ad-hoc `run start` runs.
- Preserve today's healthy-run steering deferral where possible — rules out blanket enabling pause/kill on every workflow-started run.
- Deferred to first consumer: exact wedged-vs-healthy discriminant when both share `in-progress` status — pin when kill plumbing lands.

## Out of scope

- Pause/resume for workflow-started runs.
- Redesigning workflow step execution.

## Documentation updates

- `v2/docs/daemon-host.md` — wedged workflow run kill contract and list/kill coherence.
- `v2/docs/first-workflow-walkthrough.md` — qualify the workflow-started "cannot be killed" claim for wedged recovery.

## Prerequisites

- Daemon `list` merges durable run rows with in-memory liveness.
- Workflow-started runs register in `activeRuns` with kind `workflow`.
- `jarvis run kill` routes through the daemon kill RPC.
