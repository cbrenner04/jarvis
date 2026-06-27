## Verdict

### Required outcomes

1. **Completeness must read worktree-local acceptance criteria.**  
   `--mark-ready` completeness checks must resolve the active spec path against the target worktree (same relocation semantics patch preflight uses) before reading `## Acceptance criteria`. Uncommitted AC ticks in the worktree copy must drive finalize/refuse decisions even when the index linked-checkbox is still unchecked or the marker points at a project-root path. This is the spec’s core exit-6 decision and matches documented behavior (“read … in the working tree” in `v2/docs/v1-behaviors.md`).

2. **Tests must prove the exit-6 scenario.**  
   Add coverage where specs live under the worktree, non-human-only ACs are satisfied only in uncommitted working-tree edits, and the index checkbox remains unchecked. `--mark-ready` must finalize that tree; an equivalent tree with an unchecked non-human-only AC must refuse with no side effects. Current tests place specs under `projectRoot/v1/spec/` and do not exercise the defining case.

3. **Commit failures must not be reported as push failures.**  
   When finalize commit fails (empty commit, hook rejection, etc.), the command must exit non-zero with a commit-specific reason/message, not the push-failure wording reserved for post-commit push errors. Operator recovery depends on knowing whether the tree was committed.

4. **CLI usage must match documented `--mark-ready` behavior.**  
   `COMMAND_USAGE.triage` in `v1/src/cli.ts` still describes `--mark-ready` as gate-only. Update it to state that finalize may commit dirty work, open an absent draft PR, gate once, and flip ready — consistent with `v2/docs/v1-behaviors.md` and the runbook.

### Rationale

Items 1–2 close a correctness gap: without worktree-local AC reads, a complete-but-dirty run can be refused or finalized against the wrong spec content, defeating the feature’s purpose despite passing tests in the current layout. Item 3 fixes observable misreporting that contradicts push-failure semantics in the spec and misleads recovery. Item 4 closes the remaining operator-facing doc drift for a behavior this spec explicitly changed.

### Acceptable without actuator action in this pass

- Drill-down `computeSpecComplete` / Rule 5 still recommending manual commit (follow-up alignment).
- Stuck-red runbook bullet understating finalize side effects (doc nit).
- `--merge` inheriting deeper completeness with stale error text (message-only follow-up).
- PR-open failure after successful push undocumented/untested (recoverable partial state; mirror push-failure docs in a follow-up).
- Vacuous completeness when AC section is absent, edit-signal guard divergence, duplicated commit helper, and broader test hardening (multi-subspec, `ensureDraftPr` on incomplete path, MERGED/CLOSED DRAFT guard, `readyCommand` override).
- Pre-existing `.active-spec-path` writer gap in production patch runs (separate spec).
