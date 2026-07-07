## Verdict

Required refinements:

1. **Subspec 01 — document no-migration decision.** Add a Decisions entry stating that an existing `~/.jarvis/v2.json` is not migrated and is left inert on disk after cutover; the operator must re-run `set-agents` post-upgrade to repopulate `agents` in `config.json`. This makes the intent's "retire entirely" directive explicit about the on-disk artifact it leaves behind, consistent with recording decisions as atomic ledger entries.

2. **Subspec 02 — document operator sequencing for the hard-error cutover.** Add a Decisions entry stating that `machineProfile` must be set in `config.json` before this subspec's behavior ships, since there is no bootstrap default and the next `jarvis write`/`jarvis run start` will hard-fail otherwise. This is a load-bearing operational consequence of the deliberate hard-fail design and should be recorded, not left implicit.

3. **Subspec 02 — state path-constant reuse.** Add a one-line Decisions entry confirming `resolveMachineProfile` reads `~/.jarvis/config.json` via the same path constant introduced in subspec 01 (not a redefinition), extending 01's existing decoupling rationale to the new read site.

4. **Subspec 02 — add empty-string acceptance criterion.** The Decisions section already commits to treating an empty-string `machineProfile` as a hard error; add a corresponding acceptance criterion exercising `machineProfile: ""` so the criterion set mirrors the decision.

No other changes required. The routing-surface question (v1/spec vs v2/spec) is a plan-invocation concern, not a spec-content defect, and needs no edit to the draft. The v1 nested-key collision, double-read-per-startup, and anchor-citation points are non-issues or optional polish and require no action.