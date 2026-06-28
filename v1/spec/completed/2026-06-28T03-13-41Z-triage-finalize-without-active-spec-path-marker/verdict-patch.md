## Verdict

### Required outcomes

1. **Markerless finalization must judge completeness from the worktree-local spec mirror, not only the project-root derived path.** After branch-derived spec resolution succeeds and before completeness, gate, ready, or merge checks run, the resolved path must honor the same worktree-local relocation semantics used when `.active-spec-path` is present. Markerless `--mark-ready` and `--merge` must agree with marker-present finalization when acceptance-criteria state exists only under `.worktree/<name>/…` while project-root spec files are stale or incomplete.

2. **Add tests that prove corrupted-marker refusal blocks branch-derived fallback.** When `.active-spec-path` exists but is unreadable, empty, or points at a missing/invalid path, `--mark-ready` and `--merge` must refuse with the existing marker errors and perform no gate, ready, or merge side effects, even when branch lookup would resolve a complete spec.

3. **Add a test that proves configured `plan.targetDir` wins over `v1/spec` and `v2/spec`.** Place competing complete specs in both the configured home and a fallback home for the same branch; assert finalization uses the configured home’s spec.

4. **Add a markerless `--merge` test that enters through a resolved non-worktree-name target.** At least one case must use PR-reference or spec-path resolution (not `.worktree/<name>` alone) and confirm branch-derived spec resolution still runs through the shared gated merge path.

5. **Keep `bun run typecheck` and `bun run test` passing** after the above.

### Rationale

- Outcome 1 is blocking. Documented finalize semantics judge completeness from criteria **in the working tree** (`v2/docs/v1-behaviors.md`). Marker-present resolution already relocates via worktree-local lookup; markerless resolution currently returns project-root paths directly. Pre-marker worktrees are the population this spec unlocks and commonly carry committed or dirty AC state only under the worktree-local spec copy. Without relocation, markerless finalization can refuse complete runs or accept incomplete ones — the opposite of the harness completeness contract and the spec’s intent to unblock completed pre-marker worktrees.

- Outcomes 2–4 close gaps against explicit acceptance criteria and spec tasks that are implemented but under-verified: corrupted-marker priority, home search precedence (`plan.targetDir` → `v1/spec` → `v2/spec`), and markerless `--merge` after target resolution beyond worktree directory name.

- Outcomes 5 restates existing acceptance criteria.

### Not required for this subspec

- Extracting shared branch→spec mapping from `triage.ts` (maintainability follow-up).
- Lexicographic timestamp selection among multiple plan directories (matches existing cleanup/archive behavior).
- Drill-down marker-less display (explicitly out of scope).
- Doc changes beyond what is already ticked, unless outcome 1 reveals a doc inaccuracy after the fix.
