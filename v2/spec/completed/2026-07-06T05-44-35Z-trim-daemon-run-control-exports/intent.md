---
name: trim-daemon-run-control-exports
---

# Trim daemon and run-control public surface

Drop `export` where symbols have no reference outside their file; delete outright if unused internally. Daemon/run-control scope: `daemon.ts` (`WorktreeOwnership`, `ActiveRun`, delete `DaemonRunRejectedError`) · `daemon-lifecycle` (`DaemonMetadata`, `probeSocket`) · `daemon-wire` (`DaemonWorkflowStepStatus`, `DaemonWorkflowStepTerminalOutcome`, `DaemonWorkflowStepSnapshot`) · `run-operator-error` (`RUN_OPERATOR_ERROR_REASONS`, `RUN_OPERATOR_NEXT_ACTIONS`) · `external-worktree` (`ensureExternalWorktree`, `acquireExternalWorktreeLock`, `releaseExternalWorktreeLock`). No behavior change beyond visibility.

## Decisions

- De-export or delete listed symbols only — rules out refactors, renames, or new public API.
- Delete `DaemonRunRejectedError` outright (never thrown or caught) — rules out keeping as non-exported dead code.
- **Exempt:** `WorkflowPresetName` and preset machinery — rules out touching seed 07 consumers.

## Prerequisites

- v2 lean documentation-standard and in-process daemon-test defaults are landed (seed 01)

## Documentation updates

- None — internal visibility trim with no operator-facing behavior change

## Verification

- `bun run typecheck`, `test:v2`, `test:integration:v2`
