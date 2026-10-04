# Reject already-complete implement specs

Prevent an implement launch from creating a no-op workflow when its requested spec tree has no unchecked automated work.

## Decisions

- Derive completion from every non-human-only acceptance criterion in the requested single-file spec or all linked subspecs; rules out trusting index checkboxes or persisted run status.
- Reject completion during launch construction with exit `1` and an explicit already-complete diagnostic; rules out daemon contact, worktree creation, or a recorded no-op run.

## Out of scope

- Archive the completed spec.
- Repair inconsistent index checkboxes or run rows.
- Reset a prior branch for an incomplete spec.

## Tasks

- Add file-authoritative spec-tree completion validation to implement launch preflight.
- Add focused builder and CLI regressions for complete and incomplete single-file and linked specs.
- Align durable workflow and operator documentation.

## Documentation updates

- `v2/docs/workflow-runner.md` — replace the no-op already-complete routing behavior with launch-time validation order and file-authoritative completion semantics.
- `v2/docs/operator-runbook.md` — document the diagnostic, exit status, lack of a run row, and remediation.
- `v2/docs/first-workflow-walkthrough.md` — distinguish a started run ID from an already-complete rejection.
- `v2/docs/v1-behaviors.md` — record v2's file-authoritative completeness preflight.

## Acceptance criteria

- [x] `jarvis run workflow implement` exits `1` with an explicit already-complete message when every non-human-only acceptance criterion in the requested single-file spec or every linked subspec is checked.
- [x] The already-complete rejection occurs before daemon contact, worktree creation, agent invocation, or run-row creation.
- [x] Linked-index checkbox state does not determine launch completion: checked links with an unchecked non-human-only subspec criterion still launch, while unchecked links whose subspec criteria are complete are rejected.
- [x] An incomplete requested spec still launches even when a prior run row for the same workflow is `completed`.
- [x] Unchecked human-only criteria alone do not make an otherwise complete spec runnable.
- [x] `v2/src/execution/implement-workflow-steps.test.ts` covers complete and incomplete single-file and linked spec trees, including contradictory index checkbox state; the complete-tree cases fail against the pre-fix code and pass after the change.
- [x] `v2/src/cli.test.ts` verifies the already-complete diagnostic and exit `1` occur without daemon contact.
- [x] `v2/docs/workflow-runner.md`, `v2/docs/operator-runbook.md`, `v2/docs/first-workflow-walkthrough.md`, and `v2/docs/v1-behaviors.md` describe the shipped preflight semantics without retaining the prior already-complete no-op behavior.
