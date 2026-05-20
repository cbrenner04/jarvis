---
name: run-check-fix-before-commit
---
we need to run "check:fix" before we commit. i am having to fix branches far too often with that. 

## Refine turn 1

Repo findings that narrow the real scope:

- `check:fix` already exists in `package.json`; this is not a new-script request.
- `bun run ready` already exists and is only the later PR-ready gate (`scripts/ready.ts` runs `install -> typecheck -> test -> check`). This intent is about an earlier point in the flow.
- Patch-mode commits are created directly in `src/modes/patch/subspec.ts` via `commitSubspec`, `commitWipProgress`, and `commitWipProgressWithBlocker`. Those are the places that currently do `git add -A` and `git commit` without first running `bun run check:fix`.

Recommended draft scope:

- Treat this as a patch-mode commit hygiene change, not a `ready`/PR-ready change.
- Run `bun run check:fix` in the agent worktree immediately before harness-created patch commits so the auto-fixable Biome issues land in the same commit instead of being discovered later.
- Cover all three patch commit paths (`completed subspec`, `WIP progress`, `WIP with blocker`) so behavior is consistent and branches do not diverge based on commit type.
- Keep plan-mode spec-authoring commits out of scope unless the draft finds a strong repo-specific reason to include them; the user pain described here maps to implementation branches, not plan metadata commits.

Constraints and risks the draft should make explicit:

- `check:fix` is a mutating step, so it must happen before the final `git add -A` used for the commit that Jarvis creates.
- If `check:fix` itself fails, abort the commit and surface the fixer output clearly; do not create a partial commit from pre-fix state.
- Avoid adding broader gates here such as `typecheck`, `test`, or `ready`; the intent is specifically to auto-apply Biome fixes before commit, not to move the full verification suite earlier.
- Documentation should be updated anywhere the commit/iteration workflow is described so it is clear that Jarvis may rewrite files with `check:fix` before creating patch-mode commits.

## Refine turn 2

Additional repo-specific notes for drafting:

- The three patch commit paths in `src/modes/patch/subspec.ts` currently duplicate their `git add -A` / `git commit` flow. The draft should encourage a single helper for "run fixer, then stage, then commit" so the command order and failure handling cannot drift between `commitSubspec`, `commitWipProgress`, and `commitWipProgressWithBlocker`.
- Keep the fixer scoped to the patch worktree `cwd` that the commit helper already uses. This should remain an implementation-branch behavior only; nothing in the current repo findings suggests extending it to plan-mode commits or other Git write paths.
- Preserve the existing blocker-path no-op behavior. `commitWipProgressWithBlocker` already bails out when `git diff --cached --quiet` says there is nothing staged; if the draft adds a shared fixer/staging helper, that guard should still run after the post-fix `git add -A`, not against a stale pre-fix index.
- The most targeted test surface is `test/modes/patch/subspec.test.ts`, which already exercises these three helpers. The draft should call for coverage that proves `bun run check:fix` happens before the final staging/commit step and that a fixer failure stops the commit and exposes stderr/stdout cleanly.
- Documentation updates can stay narrow. The most relevant user-facing descriptions are the patch-mode flow docs in `docs/workflows.md` and `docs/worktrees-and-commits.md`; README may also need a short note in the development/workflow guidance if the draft wants one central operator-facing mention.

## Refine turn 3

Final repo-specific notes for the draft handoff:

- The three patch commit helpers already share the same error-shaping pattern for `git commit` failures: capture the child-process error and append any available `stderr`/`stdout` to the thrown message. The new `check:fix` step should use the same style so fixer failures and commit failures are reported consistently.
- `commitSubspec` computes the acceptance-criteria commit body and updates `index.md` before it stages or commits anything. The draft does not need to broaden scope into commit-message redesign; it can keep the existing message shape and simply insert the fixer before the final `git add -A` / `git commit` sequence, or explicitly reread files after fixing if it wants commit metadata to reflect post-fix text exactly.
- Because `check:fix` runs across the worktree root (`package.json` defines it as `biome check --write .`), the draft should state that this change is intentionally repo-wide within the patch worktree, not limited to files already touched in the iteration. That is the tradeoff that prevents late formatter churn on the branch.

## user review

We aren't aligned on the basics. This should only be a change for right before `bun run ready`. That should be it. Just want to fix the `check` before `ready` is run.
