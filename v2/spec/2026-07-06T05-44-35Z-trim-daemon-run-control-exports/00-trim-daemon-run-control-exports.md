# Trim daemon and run-control exports

Several daemon/run-control symbols are exported but referenced only inside
their defining file (or not at all). Drop `export` on the listed symbols;
delete `DaemonRunRejectedError`. No runtime or operator-facing behavior change.

## Decisions

- Scope is de-export or delete of the listed symbols only — rules out refactors, renames, or new public API.
- De-export removes `export` and keeps the symbol when still used in-file — rules out deleting symbols with internal callers.
- Delete `DaemonRunRejectedError` outright — rules out retaining it as non-exported dead code.
- **Exempt:** `WorkflowPresetName` and preset machinery — rules out touching seed 07 consumers.
- No operator-facing behavior change — rules out `v2/docs/` updates.

### Symbols

| Module | Action |
| --- | --- |
| `v2/src/daemon/daemon.ts` | De-export `WorktreeOwnership`, `ActiveRun`; delete `DaemonRunRejectedError` |
| `v2/src/daemon/daemon-lifecycle.ts` | De-export `DaemonMetadata`, `probeSocket` |
| `v2/src/daemon/daemon-wire.ts` | De-export `DaemonWorkflowStepStatus`, `DaemonWorkflowStepTerminalOutcome`, `DaemonWorkflowStepSnapshot` |
| `v2/src/daemon/run-operator-error.ts` | De-export `RUN_OPERATOR_ERROR_REASONS`, `RUN_OPERATOR_NEXT_ACTIONS` |
| `v2/src/execution/external-worktree.ts` | De-export `ensureExternalWorktree`, `acquireExternalWorktreeLock`, `releaseExternalWorktreeLock` |

## Task checklist

- [ ] De-export or delete the symbols in the table above; leave all other exports in those files unchanged.
- [ ] Fix any import sites that referenced the de-exported symbols (expect none outside the defining files).
- [ ] Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `DaemonRunRejectedError` is absent from `v2/src/daemon/daemon.ts`.
- [ ] `WorktreeOwnership`, `ActiveRun`, `DaemonMetadata`, `probeSocket`, `DaemonWorkflowStepStatus`, `DaemonWorkflowStepTerminalOutcome`, `DaemonWorkflowStepSnapshot`, `RUN_OPERATOR_ERROR_REASONS`, `RUN_OPERATOR_NEXT_ACTIONS`, `ensureExternalWorktree`, `acquireExternalWorktreeLock`, and `releaseExternalWorktreeLock` are not exported from their defining modules.
- [ ] `daemon-registry.test.ts`, `daemon-queue-promotion.test.ts`, `daemon-lifecycle.test.ts`, `daemon-wire.test.ts`, `run-operator-error.test.ts`, and `external-worktree.test.ts` stay green (behavior unchanged by the visibility trim).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — internal visibility trim with no operator-facing behavior change.
