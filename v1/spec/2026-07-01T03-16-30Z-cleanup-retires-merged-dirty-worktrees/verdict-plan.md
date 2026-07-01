## Verdict — required refinements

1. **Not-merged dirty preservation AC is wrong.** Merged-mode scan exits silently at the merge gate (`isMergedPr` false → `continue`); the `skipping … has uncommitted or unpushed changes` line is emitted only for **merged + dirty**. The AC pinning that stdout line for not-merged dirty worktrees describes behavior that neither exists today nor is proposed. Replace with silent non-removal: worktree stays on disk, is absent from the removal preview, and is not force-removed.

2. **Triage gap: `untracked-only` + `MERGED`.** Rule 4 covers only `modified`/`mixed`; `untracked-only + MERGED` (no spec path) still falls through to generic fallback (`triage-command.test.ts`). After cleanup force-retires merged-but-dirty trees, triage must advise direct `jarvis1 cleanup` for this class too — extend rule 4 (or add an equivalent rule), update the triage test, and align `worktrees-and-commits.md` if the rule numbering/text changes.

3. **`v1-behaviors.md` must cover triage, not only cleanup.** Spec-guidance requires cataloging every v1 behavior change. Add triage rule 4 (merged + dirty porcelain → `jarvis1 cleanup` without stash) to doc tasks and the `v1-behaviors` update scope; cleanup-only wording is insufficient.

4. **Add triage test task.** The no-`stash` AC pins triage output but no task assigns `triage-command.test.ts` updates (rule 4 modified/mixed + untracked-only). Add an explicit task asserting `jarvis1 cleanup` without `stash`.

5. **Add `--dry-run` AC for merged-but-dirty.** Today dirty merged trees never enter `toRemove`, so dry-run omits them. Force-retire makes preview listing an observable behavior change; pin that merged-but-dirty worktrees appear in `--dry-run` output.

6. **Rewrite scoped-abandon preservation AC as test citation.** The scoped merged-PR refusal AC paraphrases stderr; spec-guidance requires preservation ACs to cite the pinning test. Replace with `` `cleanup-command.sandbox-unrunnable.test.ts` scoped merged guard stays green ``.

7. **Reframe runbook doc task.** End-of-session cleanup does not document the manual `git worktree remove --force` workaround; the task should **add** positive guidance (merged-but-dirty plan worktrees retire via `jarvis1 cleanup`) rather than only “drop workaround.”

**Not required (defended correctly):** merged + unpushed-only triage (rule 2 already covers); `gh` inspection failure semantics (silent non-removal, intent-aligned); single-subspec scope; `commit:false` external specs; lock / mixed-queue / squash-merge edges; full `worktrees-and-commits.md` rules 6–7 hygiene beyond rule 4.
