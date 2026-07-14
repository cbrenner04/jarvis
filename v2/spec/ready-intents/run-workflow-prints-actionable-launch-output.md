---
name: run-workflow-prints-actionable-launch-output
---

# `run workflow` prints actionable output, not a bare UUID

`jarvis run workflow` prints only the run id. The operator gets no next step and must
already know that `jarvis run list` / `jarvis run log <id>` / `jarvis run wait <id>`
exist.

Print the run id plus the actionable follow-up (log and wait commands for that id),
and print the run's terminal outcome — not just its id — when the CLI observes one.
The run id stays machine-readable on its own line so existing scripts that capture
stdout keep working; the follow-up and outcome text are additive lines around it.

## Documentation updates

- `v2/docs/write-behavior.md` — CLI surface table: `run workflow` output shape.

## Prerequisites

- `run workflow` exit status reflects the run's terminal outcome
