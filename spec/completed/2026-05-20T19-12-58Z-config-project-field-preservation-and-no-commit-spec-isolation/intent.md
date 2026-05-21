---
name: config-project-field-preservation-and-no-commit-spec-isolation
---

# Intent

Two related bugs surfaced while debugging why `jarvis config show` was omitting per-project plan overrides:

1. **Silent misconfiguration.** A user-edited `~/.jarvis/config.json` placed `specTimestamp` / `commit` directly on a project object instead of nested under `plan` (the schema actually expects `projects.<name>.plan.{specTimestamp,commit}`). `validateConfig` silently dropped the unknown flat keys, so `jarvis config show` and `resolvePlanFlags` both behaved as if the override was absent, with no diagnostic. The same silent-drop applies to any unknown key on a project object.

2. **Project field loss on writes.** `setProjectGit` (src/config.ts:709-728) and `registerProject` (src/config.ts:665-687) rebuild the project object from a hand-picked subset of fields, dropping `plan` and `siblings` on every write. Re-running `jarvis init` on a known project, or running `jarvis config set-project-git <name> ...`, silently erases per-project plan flags and sibling lists from disk.

3. **Non-commit plan specs leak into the target repo.** With `modes.plan.commit: false` (or a project override of the same), `jarvis plan` is supposed to write the resulting spec tree into `~/.jarvis/specs/<project-id>/...`, *not* into the target directory. The current implementation in `src/commands/plan.ts` sets `worktreePath = project.root` for no-commit runs and lets the agent author the spec under `<target-repo>/spec/<tempPlanName>/` throughout the refine, draft, and review phases. Only after the draft phase does a `renameSync` (src/commands/plan.ts:1350) move the directory out of the target repo. Any failure, kill, or review-phase write before the move leaves spec scaffolding inside the target repo — exactly the pollution that `commit: false` is supposed to prevent. Review phases that run after the rename still pass `worktreePath` (= `project.root`) as the spec write root in some branches, which is also wrong for no-commit runs once the spec is supposed to live at its final external location.

Fix all three with one spec so the no-commit promise actually holds and per-project plan overrides survive harness writes. Land a clear validation error so the original misconfiguration symptom (`config show` quietly missing fields) can never recur.
