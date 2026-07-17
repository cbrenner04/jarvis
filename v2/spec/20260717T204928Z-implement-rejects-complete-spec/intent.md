---
name: implement-rejects-complete-spec
---

# Implement rejects an already-complete spec

`jarvis run workflow implement` reads the requested spec before daemon contact or worktree creation. When every non-human acceptance criterion in the spec file or linked subspecs is checked, it reports that the spec is already complete and exits non-zero. A run row marked `completed` does not suppress an incomplete spec.

## Decisions

- Derive completeness from acceptance criteria in the requested spec tree; rules out trusting run status or top-level index checkbox state.
- Reject before daemon start and workspace mutation; rules out recording a silent no-op workflow run.
- Use a non-zero exit with an explicit completion message; rules out making “already done” indistinguishable from “work started” to callers.

## Out of scope

- Archiving the complete spec.
- Repairing inconsistent run rows or index checkboxes.
- Resetting an incomplete spec's prior branch.

## Prerequisites

## Documentation updates

- `v2/docs/operator-runbook.md` — already-complete launch result and exit semantics.
- `v2/docs/first-workflow-walkthrough.md` — distinguish a started implementation from an already-complete request.
- `v2/docs/v1-behaviors.md` — record v2's file-authoritative completeness preflight.
