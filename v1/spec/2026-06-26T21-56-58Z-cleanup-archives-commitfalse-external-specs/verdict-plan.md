# Verdict

Three correctness gaps are upheld and require refinement; one needs a scope line. The spec is otherwise well-targeted and grounded in the real code.

## Required refinements

1. **Reserved-name guard on the external home.** The external home `~/.jarvis/specs/<proj>/` holds two reserved siblings — `completed/` and `ready-intents/` — directly alongside spec dirs. The existing in-repo guard only protects `completed`. Add a Decision and an acceptance criterion that the external archive path refuses to relocate a spec dir whose basename is a reserved name (`completed` or `ready-intents`), so a pathological spec name cannot relocate (and then compound via prune) a reserved directory. Cheap guard; the miss is irrecoverable corruption of the external home.

2. **Plan-branch / exact-match invariant must be stated and tested.** The design drops the readdir timestamp scan on the external path and relies on exact `<proj>/<spec-dir>` matching, which is only safe because run worktrees branch on the timestamped dir basename. A `commit:false` *plan* worktree carries an untimestamped `plan/<name>` branch and would not match. The spec relies on the unstated invariant that commit:false plan worktrees never reach archiving (they produce no merged PR, so they are filtered out earlier). Record that invariant as an explicit Decision and back it with a test asserting a `plan/`-prefixed branch under `commit:false` is left untouched. Per spec guidance, a load-bearing simplification resting on an invariant must state the invariant.

3. **Prune ordering must be specified.** "Prune the consumed ready-intent" is listed as an independent step with no ordering relative to the archive move. If the move fails (e.g., destination exists → reported failure), pruning anyway destroys the seed while the spec sits unarchived — the exact hand-recovery state #566 aims to eliminate, made worse. Add a Decision and acceptance criterion that the ready-intent is pruned **only after a successful archive move**; a failed move leaves both source and ready-intent intact.

4. **Mode-switch scope line.** Cleanup branches on the *current* effective `plan.commit`, which is the only coherent choice (no per-spec record of authoring mode exists). Add one Out-of-scope line stating that specs authored under a different `plan.commit` mode than currently configured are not retroactively archived — converting a silent gap into accepted behavior.

## Not required

- `?? CONFIG_DIR` fallback parity and the `CleanupCommandOptions` field-surface change are reviewability polish already implied by task-checklist item 1 and the "reuse intent/plan resolution" goal; optional one-line mentions, not correctness gaps.
- `ProjectMatch` field-divergence is ruled out by the shared type — cleanup's match is the same `ProjectMatch` intent/plan consume, and the existing path-naming ACs already pin the concrete external paths. No Decision needed.