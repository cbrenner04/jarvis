## Verdict — required outcomes

### 1. Triage rule 4 must win for merged + dirty plan worktrees (blocking)

**Outcome:** For `untracked-only` + `MERGED` with a `specPath` and untracked porcelain confined to the spec directory (the common plan-worktree shape), named triage **Suggested next moves** must advise `jarvis1 cleanup` for discard and must **not** suggest seed-spec commit/push (rule 3) or generic fallback-only inspect.

**Rationale:** Suggested-moves rules are first-match-wins. Rule 3 currently matches before rule 4 with no `MERGED` guard, so the acceptance criterion pinning `untracked-only` + `MERGED` → `jarvis1 cleanup` (no stash) is unmet for the primary plan use case. Spec task and AC explicitly require rule 4 coverage for `untracked-only` + `MERGED`.

**Test outcome:** Coverage must assert rule 4 for `untracked-only` + `MERGED` **with** `specPath` and spec-dir untracked files. The test at line 847 that only checks `Inspect` and omits `specPath` must be replaced — it passes on rule 4’s inspect line without pinning discard guidance and does not catch the rule-3 collision.

---

### 2. `worktrees-and-commits.md` Cleanup section must match force-retire (blocking)

**Outcome:** The **Cleanup → Default behavior** bullets must describe current merged-mode semantics: merged PR worktrees are enqueued and force-removed regardless of porcelain or unpushed commits; not-merged worktrees silently skip at the merge gate (absent from preview, not removed); `isMergedPr` inspection failure keeps silent skip. Remove stale language about skipping dirty/unpushed merged worktrees and “clean-worktree, unpushed-commit” gates.

**Rationale:** Triage rule 4, `v2/docs/v1-behaviors.md`, and `operator-runbook.md` are aligned; the Cleanup section still documents pre-change behavior. Operator-facing docs must not contradict shipped behavior. Spec doc tasks require `worktrees-and-commits.md` alignment.

---

### 3. Triage test hygiene must pin rule 4, not incidental overlap (blocking with #1)

**Outcome:** Rule-4 tests must explicitly require `jarvis1 cleanup` in discard guidance and absence of `stash`, for all three dirty kinds including `untracked-only`. Tests must not pass solely because rule 4 and fallback both emit an “Inspect” line.

**Rationale:** False-positive regression guards undermine the spec’s triage AC. Fixing rule ordering without fixing tests leaves the gap unguarded.

---

### 4. `isMergedPr` inspection-failure test (optional, non-blocking)

**Outcome:** A named test documenting that a worktree that would qualify for merged-mode removal is silently non-removed when `isMergedPr` returns false (simulating `gh` failure) would pin fail-closed semantics. Not required to satisfy current AC — `not-merged dirty worktree is silently non-removed` already exercises the same retire path — but worth adding if touched.

---

### No action required (confirmed in scope)

- **Merged-mode cleanup core:** Enqueue on `isMergedPr` only, `--force` remove, dry-run preview, not-merged silent skip — matches spec AC.
- **`--abandon` paths:** Unchanged; scoped merged guard preserved.
- **No discard warning before force-remove:** Explicitly deferred in spec/intent.
- **Session-end verdict vs suggested moves:** Out of spec scope; intentional separation.
- **`hasDirtyStatus` removal, lock preflight asymmetry, partial retire failure:** Pre-existing or correctly scoped; no change required.
- **`v1-behaviors.md` and `operator-runbook.md`:** Already aligned with force-retire and triage rule 4.

---

**Bottom line:** Cleanup implementation is spec-complete. Merge readiness is blocked on triage rule ordering (#1) and incomplete operator docs (#2), with test fixes (#3) riding the triage change.
