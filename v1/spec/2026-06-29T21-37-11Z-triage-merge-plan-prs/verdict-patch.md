## Verdict: refinements required

Core eligibility is correct: `plan/*` heads skip `isSpecComplete` in `triage --merge`, patch branches retain the gate, the gated merge sequence is unchanged, and successful merge has no run/worktree side effects. Remaining gaps are refusal-prefix consistency, AC-level test coverage, and one doc cross-reference.

### Required outcomes

1. **All `--merge` refusals use the pinned class prefix.** Every merge refusal line must match `triage --merge (<class>):` before the reason stem. The defensive path when `worktreeName` is absent must not emit a classless `triage --merge:` line.

2. **Plan-branch post-resolution refusal tests match AC.** Beyond the existing gate-failure case, tests must prove `plan/*` targets refuse with `triage --merge (plan PR):` for post-resolution failure classes named in the subspec: CI red, CI poll timeout, worktree lock, and merge transport failure. Each must assert the symmetric guard: stderr must not contain `implementation PR`.

3. **`--merge` lock and transport refusal tests exist.** Add merge-path coverage for live worktree lock refusal and `adminMerge` failure with correct class prefix and preserved reason stems. `--mark-ready` lock coverage does not satisfy the merge AC.

4. **Legacy patch refusal tests anchor the prefix.** Tests that only assert reason stems (poll timeout, empty/null checks, gate failure on already-ready PR, and any other cited preservation cases) must also assert `triage --merge (implementation PR):` via the shared refusal helper, not stems alone.

5. **Cleanup/archival docs distinguish completeness from plan merge.** `v1/docs/operator-runbook.md` (cleanup/archival) and `v2/docs/v1-behaviors.md` (`cleanup` bullet) must not claim archival completeness is shared with plan `--merge`. Archival completeness aligns with `--mark-ready` / implementation finalize semantics; plan `--merge` may land with unchecked subspec AC.

6. **Pre-classification `unknown worktree` stems are pinned in durable docs.** Missing `.worktree/<name>` after successful target resolution and `unable to get branch name` currently emit `unknown worktree` before branch classification. Pin these stems under the `unknown worktree` bucket in `v2/docs/v1-behaviors.md` (and runbook if operator-facing), or reclassify them post-resolution when branch kind is knowable — pick one model and align code, tests, and docs.

### Rationale

- Outcomes 1 and 6: subspec pins exactly three classes and the `triage --merge (<class>):` format; classless or ambiguous classification undermines operator parsing and test anchors.
- Outcomes 2–4: subspec AC explicitly requires plan post-resolution refusal taxonomy, the symmetric `implementation PR` guard, and named failure-class coverage; only gate failure is plan-tested today, and several patch tests omit prefix assertions despite AC citing prefix behavior.
- Outcome 5: Merging section correctly documents plan vs implementation asymmetry; cleanup/archival still overstates `--merge` completeness and would mislead operators after a merged plan PR.

### Not required for this actuator pass

- `intent.md` alignment (planning artifact; subspec doc tasks target runbook and `v1-behaviors.md` only).
- `--mark-ready` asymmetry test (documented; not in subspec AC).
- `mergeClass` helper extraction or refusal-module reorganization (style only).
- Markerless plan-spec-path incomplete-AC success test (out of scope per subspec; resolution test with complete spec is sufficient prerequisite plumbing).
