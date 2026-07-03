## Verdict

Two required outcomes, both confirmed necessary:

1. **`intent.md`'s Documentation updates section must list the `v2-architecture.md` Domain map change.** The prior adjudication explicitly required this reconciliation and it was not applied — `intent.md` still lists only `write-behavior.md` and `v1-behaviors.md`. Since the subspec's Domain map update is correct and matches precedent set by prior Execution/Persistence/Daemon relocations, the fix is to add that line to `intent.md`, not to remove it from the subspec. Outcome: `intent.md`'s Documentation updates list is fully traceable to the subspec's actual doc changes.

2. **Restore the original multi-line JSDoc on `pause`, `resume`, `kill` (in `tui-daemon-client.ts`) and `connectTuiLogTail` (in `tui-log-tail-client.ts`).** The move commit collapsed these into single-line comments, dropping per-parameter (`@param runId`) and per-error-case detail (e.g. the itemized `unknown_run`, `run_not_active`, `terminal_run`, `run_in_progress`, `worktree_claimed` list). The spec scopes this move to mechanical relative-import fixups only — no content edits to the moved files — and the repo's terseness policy explicitly does not authorize under-documenting code. Outcome: the moved declarations carry their original JSDoc content unchanged, with only import paths adjusted.

No other changes to spec scope, decisions, or task checklist are required.