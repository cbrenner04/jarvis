---
name: actuator-retry-reuses-persisted-verdict
---

# Retrying the actuator reuses the persisted verdict instead of restarting the workflow

The actuator's only input is the adjudicated verdict, already written to `verdictPath` before it
runs. Re-dispatching the workflow to retry it re-runs a ~10-minute write step and a ~8-minute shrink
to reach the same input — pure waste.

## Decisions

- Re-dispatching the same workflow after a failed actuator reads the persisted verdict and re-invokes
  only the actuator; rules out re-dispatch that replays write, shrink, or debate.
- The retry does not invoke the write or shrink steps, and does not re-run the adversary/advocate/adjudicator roles; rules out a "resume the review cycle" path that repeats the debate.
- A retry with no persisted verdict on disk fails naming the missing verdict rather than re-deriving it; rules out silently falling back to a full workflow re-run.

## Acceptance criteria

- [ ] Retrying a timed-out actuator via workflow re-dispatch reuses the persisted adjudicated verdict; a test asserts neither the write nor the shrink step is invoked and debate roles are not replayed.

## Documentation updates

- `v2/docs/operator-runbook.md` — recover a failed actuator by re-dispatching the same workflow; expect actuator-only replay, not write/shrink/debate.
- `v2/docs/workflow-runner.md` — actuator retry on re-dispatch reads the persisted verdict.

## Prerequisites

- The adjudicated verdict is written to `verdictPath` before the actuator is invoked.
- An actuator role failure is distinguishable from the debate roles' failures in the review outcome.
