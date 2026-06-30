## Verdict: required refinements

1. **Record supersession of the landed merge-target plan policy.** Add a decision that this change amends the prior “plan worktrees resolve through marker match, not basename alone” rule by adding timestamp-stripped plan-slug lookup; marker match stays valid. *Rationale: without an explicit amendment, implementers and doc updaters can treat marker-only as still exclusive against `v1/spec/completed/2026-06-27T17-26-00Z-merge-target-by-worktree-or-spec/` and current `v2/docs/v1-behaviors.md`.*

2. **`v1-behaviors.md` update must replace marker-only language, not silently append.** The doc task should state that `triage --merge` plan resolution is no longer marker-exclusive for path-separator inputs, and that bare `.md` plan entry remains marker-only (matching the recorded deferral). *Rationale: operator/workflow behavior belongs in `v2/docs/`; partial updates leave contradictory operator guidance.*

3. **Rewrite preservation AC #3 as a test citation, not scenario paraphrase.** State that existing `triage-command.test.ts` `merge target resolution` tests stay green (name the describe block or pinning test names). *Rationale: spec-guidance requires preservation ACs to anchor to pinning tests; paraphrased groups can assert behavior the suite does not guarantee.*

4. **Close the plan-ambiguity verification gap between AC #4 and the checklist.** AC #4 requires ambiguous plan spec paths refuse with no merge side effects; the checklist must include a verifiable plan-specific ambiguity case (e.g. marker match on one worktree and plan-slug match on another for the same normalized path), not only patch ambiguity preservation. *Rationale: acceptance criteria must be independently checkable from the task checklist.*

5. **Add an inline doc-comment update task for the exported merge-target resolver contract.** When `resolveMergeTarget` / spec-path resolution gains a third strategy, update the exported symbol’s doc-comment per `v2/docs/documentation-standard.md`. *Rationale: symbol contract is the durable home for resolution order and strategies; behavior change without it violates the documentation standard.*

### No refinement required

- Scope limited to `--merge`; patch basename/marker behavior unchanged; union+dedupe+refuse posture; reuse of `stripPlanSpecTimestampPrefix`; integration AC pattern matching the prior merge-target spec; `cli.ts`/runbook omission for this refinement-only change; backslash inheritance from existing path-separator handling; external/`v2/spec`/custom `targetDir` paths working by construction; no plan-branch shape validation beyond existing marker posture; optional patch/plan-slug collision test or AC #1 split.
