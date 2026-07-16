---
name: ready-gate-and-flip-failures-are-distinct
---

# Ready-gate and ready-flip failures are distinct

The terminal log and `run list` currently collapse a red ready gate and a failed
draft-to-ready flip into `ready_finalize_failed`. An operator cannot tell whether
the branch failed validation or GitHub publication failed.

Expose distinct gate-red and flip-failed outcomes in the terminal run evidence and
operator list surface before changing either recovery path.

## Decisions

- Preserve gate-red and flip-failed as distinct terminal evidence through logs and `run list`; rules out collapsing both into a generic finalize failure.

## Documentation updates

- `v2/docs/workflow-runner.md` — distinct finalization outcomes.
- `v2/docs/daemon-host.md` — terminal evidence and `run list` projection.
- `v2/docs/operator-runbook.md` — how to diagnose gate-red versus flip-failed.
- `v2/docs/v1-behaviors.md` — record the changed v2 finalization behavior.

## Prerequisites
