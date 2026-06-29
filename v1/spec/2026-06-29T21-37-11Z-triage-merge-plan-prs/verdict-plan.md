## Verdict: refinements required before implementation

Core slice is sound — skip `isSpecComplete` for `plan/*` in `triage --merge`, preserve patch gates and gated merge sequence, no post-merge run. The draft is not implementation-ready; resolve the items below.

### Required refinements

1. **`plan-spec-path` dependency must be explicit**
   - Markerless timestamped plan spec paths do not resolve today; only `.active-spec-path` marker-backed plan worktrees pass existing tests.
   - A separate ready-intent covers resolution but is unshipped and not listed as a prerequisite.
   - The spec must either: list that work as a prerequisite/index dependency and defer `plan-spec-path` AC until it ships; or narrow success AC to worktree + PR-ref entry points only.
   - Task line (“marker-backed”) and AC (markerless success) contradict each other — align on one.

2. **Refusal taxonomy must be internally consistent**
   - Decisions and intent name four classes (`plan PR`, `implementation PR`, `unknown worktree`, `non-mergeable state`); ACs assign gate/CI/lock/transport failures only to `plan PR` / `implementation PR`, with no coverage for `non-mergeable state`.
   - Pick one model and make decisions, ACs, and doc tasks agree: either drop `non-mergeable state` as a literal class, or define when it is emitted and add matching ACs.

3. **Resolution-stage message changes must be scoped and anchored**
   - Mandating `unknown worktree` for listed resolution failures conflicts with current `--merge` tests (`unresolvable target`, etc.).
   - Taxonomy change is new behavior, not preservation — state that explicitly.
   - Either cite affected resolution tests as anchors to update, or require class labels additive to existing message stems (not blind replacement).
   - Map every resolution failure the spec touches (unassigned paths, ambiguity, PR lookup failures, `no spec found for branch`, etc.) to a class or to “unchanged message, no class prefix.”

4. **Pin the stderr label format**
   - “Name” the target class is underspecified for tests and `v2/docs/v1-behaviors.md`.
   - One pinned pattern (prefix vs embed, exact strings) must appear in an AC or doc task so implementers and tests do not diverge.

5. **Plan success fixtures must exercise real `plan/*` classification**
   - Success ACs must require a `plan/<name>` head branch in plan worktree/PR fixtures.
   - Marker-only plan-spec resolution alone does not prove eligibility skip is exercised on a real plan branch.

6. **Add symmetric negative refusal guard**
   - Patch incomplete-spec AC requires `implementation PR` in stderr; add the mirror — plan-target refusals must not emit `implementation PR` for the same failure classes.

7. **Document `--mark-ready` vs `--merge` asymmetry**
   - Decision correctly limits scope to `--merge`, but runbook Merging still implies spec-complete finalize for all targets.
   - Doc tasks must state: plan PRs may `--merge` with unchecked subspec AC; `--mark-ready` completeness semantics stay unchanged.

8. **Preservation ACs for message rewrites**
   - Incomplete-spec preservation correctly cites `triage-command.test.ts`.
   - Any resolution-message rewrite must cite the same style of test anchors, or be marked as intentional new behavior — not implied “unchanged.”

### Optional (reviewability, not design blockers)

- If refusal-taxonomy work is large relative to eligibility skip, split into a second subspec so `00` can ship eligibility independently.
- Low-cost task refinement: assert merge path does not invoke run/worktree creation (preservation of today’s isolation).

### Upheld without required change

- Branch classification by `plan/*` head, not worktree dirname.
- Reuse gated merge sequence unchanged; no post-merge `jarvis1 run`.
- Cleanup archival, ready-gate scope, behind-base guard, session display — out of scope.
- Doc checklist items need no automated prose AC per spec guidance.
