## Verdict: required refinements

### Blockers (fix before implementation)

1. **Classification order contradicts PR-reference acceptance.** Step 2’s spec-path shape rule (`/` or `.md`) classifies GitHub pull URLs as spec paths, violating AC3 and the task checklist. Refine the order so PR-reference forms (`#N`, bare `N` when no worktree dir matches, `https?://…/pull/N`) are recognized before spec-path shape, while step 1 (existing `.worktree/<arg>` directory) still precedes bare-integer PR parsing. *Rationale: without this, a stated acceptance criterion is unimplementable as written.*

2. **Add `## Prerequisites`.** Intent names gated `--merge` as a dependency; the subspec omits it. Name the landed merge-on-green-gate behavior this spec extends (gated `--merge` pipeline, injectable `ghRunner`). *Rationale: spec-guidance requires prerequisites for blocking dependencies; AC1’s preservation citation is insufficient for a reader who only opens this subspec.*

### Resolution contract (decisions + ACs)

3. **Pin spec-path resolution anchor.** State that spec paths resolve relative to **cwd** (same as `jarvis1 run` / `getSpecName`), then normalize to absolute paths for `.active-spec-path` comparison — not relative to `projectRoot`. *Rationale: “run-style” and “normalized absolute paths” are ambiguous without this; wrong anchor yields silent mismatches.*

4. **Pin bare-`.md` filename handling.** A token with only a `.md` suffix and no path separator must not use parent-dir basename as a worktree name (e.g. `index.md`). Either require a path separator for basename shortcut, or restrict bare filenames to `.active-spec-path` scan only. *Rationale: current shape rule is hazardous for common filenames.*

5. **Union basename match and marker scan.** Collect worktree candidates from both strategies, dedupe by worktree path; >1 distinct worktrees → AC5 ambiguity. *Rationale: two strategies can disagree; silent preference for one violates intent (“find the worktree backing that spec”).*

6. **Plan worktrees via marker, not basename alone.** Timestamped plan spec directories (e.g. `v1/spec/2026-…-foo/`) do not basename-match `.worktree/plan-foo/`. State that plan worktrees resolve through `.active-spec-path` marker match. *Rationale: intent’s spec→worktree→PR chain includes plan specs; basename-only misses them.*

7. **Pin `findMatchingOpenPrs` placement and add AC.** The decision names reuse but not where. State it applies when a PR reference resolves to a head branch (before worktree lookup) and/or in merge pre-checks when branch maps to multiple open PRs; add an AC that multiple open PRs for the resolved branch refuse with the existing cleanup/triage semantics and exit non-zero without merge. *Rationale: `triageMerge` today uses `getPrState(branch)` with no multi-PR guard; without placement + AC, implementers may skip or misplace the guard.*

8. **Add AC for `gh` transport/auth failures during PR resolution.** AC4 covers semantic unresolvability; add explicit fail-closed behavior (non-zero exit, no `gh pr merge`) when `gh` fails during PR-ref lookup. *Rationale: resolution widens the `gh` entry surface; transport failures must not fall through to merge.*

### Consistency and operator-facing clarity

9. **Align `index.md` H1 with subspec scope.** Index title omits PR reference; subspec title and AC3 include it. *Rationale: index is the routing file; title drift misleads reviewers.*

10. **Document resolution vs pre-check error distinction.** Resolution answers “which worktree?”; post-resolution failures (missing marker, incomplete spec, lock held, closed PR) remain distinct from “unresolvable target” at classification time. One line in docs/decisions is enough. *Rationale: prevents operators conflating “no worktree for spec” with “worktree found but not merge-ready.”*

### Defended — no refinement required

- Scope limited to `--merge`; `--mark-ready` and read-only triage stay worktree-name-only (AC7).
- Cross-project / `--repo` invocation out of scope.
- Post-resolution delegation to existing `resolveTriageNamedWorktree` / merge pipeline unchanged.
- Closed/missing PR at merge time handled by existing pre-checks (two-phase design).
- Deferred: plain `triage <spec-path>` drill-down; non-canonical PR URL variants beyond the three AC3 forms.
- Doc homes (`v1-behaviors.md`, `operator-runbook.md`, `cli.ts` help) sufficient per documentation-standard single-home rule.
- Preservation AC citing `triage-command.test.ts` is well-formed per spec-guidance.
