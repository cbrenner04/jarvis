---
name: already-complete-spec-exits-non-zero
---

# Re-running an already-complete spec reports it and exits non-zero

When an operator requests `run workflow implement` on a spec that is genuinely complete, the CLI
prints that the spec has no unticked acceptance criteria and exits non-zero. It does not start a
run, and it does not hand back a run id that reads as success.

## Decisions

- Completeness is read from the **spec file** (zero unticked acceptance criteria), never from a
  run row's status — a `completed` row on a spec with unticked criteria must not suppress work.
- Exit is non-zero so "already done" is distinguishable from "started" by exit code alone,
  without inspecting run ids.

## Out of scope

- Repairing run rows that wrongly claim `completed`.

## Prerequisites

- A CLI `run workflow` request no longer short-circuits on a prior run's `completed` status.

## Documentation updates

- `v2/docs/operator-runbook.md` § Known gotchas — delete the bullet about a re-requested
  implement being a silent no-op; document the new already-complete non-zero exit.
