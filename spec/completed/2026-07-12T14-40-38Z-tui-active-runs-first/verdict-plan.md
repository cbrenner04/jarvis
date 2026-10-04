## Verdict — refinements required

The classification, scope, and single-subspec sizing all hold. Six refinements:

1. **Replace the "resumable ⇒ active" rationale.** The stated reason does not select the drawn boundary: `killed`, `paused`, and `budget-soft-stopped` are all resumable per `v2/src/lib/run-operator-error.ts`, yet `killed` belongs in history. State the actual discriminator instead: **terminal = the run reached an end state (operator ended it, or it finished/failed/blocked); active = the run is still steerable toward completion, waiting on the operator or the agent.** Keep the same status lists.

2. **Name the daemon's `isTerminalRunStatus()` and declare the divergence deliberate.** `v2/src/daemon/daemon.ts:129` defines terminal as `completed | blocked | killed | paused | failed` — it includes `paused`. An implementer splitting "active vs terminal" will find and reuse it, reintroducing the exact defect this spec exists to fix, and all but one AC would still pass. The spec must say the TUI classification is intentionally *not* that predicate (the daemon's answers "may I stop supervising?", the TUI's answers "is the operator still steering?").

3. **Pin selection behavior across polls.** `v2/src/tui/tui-entry.tsx` keeps selection anchored to the selected `runId` and drops it only when the run leaves the selectable set. Grouped order must seed only the *initial* selection; a selected run that transitions to a terminal status keeps its `>` and slides into the terminal group. Add a decision and an acceptance criterion covering this, so no implementer "fixes" it by re-deriving selection from the grouped order each poll and yanking selection mid-watch.

4. **Single source of the grouped order.** The table render and the default-selection derivation must consume one shared ordering helper, not two parallel implementations that can drift. Record as a decision; do not turn it into an AC about module structure.

5. **Add `v2/docs/v1-behaviors.md` to Documentation updates.** This changes existing TUI behavior; the catalog's run-table and selection-default entries carry no ordering contract and go stale on ship. Repo rule is unconditional for behavior changes.

6. **Make the walkthrough contract operator-legible.** "Daemon order preserved" is an internal term — `state.runs` is newest-first (why the queued subset is reversed for FIFO). The walkthrough must state what an operator sees: active runs first (newest first), terminal history after (newest first), Queue unchanged in FIFO order. Also add one sentence covering the all-terminal case, where selection correctly falls to the first terminal row.

Not upheld: no split is needed, no coordination gate with the row-navigation intent (a shared ordering helper is compatible with "display-only", which forbids daemon/wire changes, not reusable functions), and no unhandled-status handling is required — the five active + four terminal + `queued` are exactly the members of `RUN_STATUSES`, so an exhaustive union over `RunStatus` makes any future status a typecheck failure rather than a silent fallthrough.