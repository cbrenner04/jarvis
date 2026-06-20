# plan against a `git: false` project misfires the no-commit boundary check and git cleanup

## Problem

`jarvis1 plan` against a project configured `git: false` (with `commit: false` inherited
globally) cannot complete. Plan mode does not honor `git: false` the way patch/run does
(loop-only, no worktree/branch). Instead it still creates a `.worktree/plan-<name>` worktree
and a `plan/<name>` branch, the draft completes, and then the no-commit external-spec boundary
machinery aborts with `plan: boundary violation detected before draft commit`. Post-failure
cleanup then throws two more errors that confirm git ran when it should not have: a
`git checkout -- spec/` revert against an untracked `spec/`, and a push of a branch with no
upstream.

Net effect: an operator who wants fully-local, no-remote planning (a scoped `git: false`
project pointing at a dedicated worktree) cannot plan at all — the very config that should mean
"do no git" is the one that trips git.

## Evidence (this session)

Config added to `~/.jarvis/config.json` (global `git: true`, `modes.plan.commit: false`):

```json
"groceries-redesign": { "root": "/…/groceries-redesign-wt", "git": false }
```

`jarvis1 plan --repo groceries-redesign <ready-intent>.md` produced (verbatim, trimmed):

```
plan: warning: 00-…: Behavioral/preservation AC lacks test or source anchor: "…unchanged…"   (x2, non-blocking)
plan: draft phase completed
plan: boundary violation detected before draft commit
warning: failed to revert spec/: Error: Command failed: git checkout -- spec/
error: pathspec 'spec/' did not match any file(s) known to git
fatal: The current branch plan/color-scheme-overhaul has no upstream branch.
  (hint: git push --set-upstream origin plan/color-scheme-overhaul)
─── plan summary ───
spec: spec/color-scheme-overhaul/index.md
exit reason: error
phase attempts: 1
```

A `.worktree/plan-color-scheme-overhaul` worktree and a `plan/color-scheme-overhaul` branch
were created under the project root despite `git: false`. The summary's `spec:` path is the
in-repo `spec/…` (committed-mode shape), not the external `~/.jarvis/specs/<project>/…` path
expected under `commit: false`. The AC-anchor warnings are non-blocking
(per `v1/docs/plan-mode.md`) and are not the cause; the boundary violation is.

Same machine, same session: the operator's other track uses the `groceries-client` project
with `git: true` + `commit: false`, and plan succeeds there. So the breaking variable is
`git: false` on the planned project.

## Direction

Pick one and make it coherent; today's behavior is the worst of both (does git, then blames a
boundary):

- **(preferred) Make plan honor `git: false` as loop-only**, mirroring patch/run: no
  `.worktree/plan-<name>`, no `plan/<name>` branch, no push, no `git checkout` revert. Write the
  spec to the external `~/.jarvis/specs/<project-safe-id>/<spec-dir>/` and enforce the write
  boundary via the agent `cwd` argument rather than `git status` diffing — exactly the design the
  no-commit work already articulated (see references). On a `git: false` root the boundary check
  should not produce a false-positive violation.
- **(fallback) Reject the combination fast** at config validation / plan preflight with a clear
  message (e.g. "plan does not support `git: false`; use `commit: false` for external specs"),
  instead of a late boundary violation followed by confusing `git checkout`/push errors.

Either way, the cleanup git calls (`git checkout -- spec/`, branch push) must be guarded so they
never run when `git: false` or when the spec lives in the external no-commit dir.

## Out of scope

- The patch/run loop-only path — it already honors `git: false` correctly (`jarvis1 run --repo
  <git:false project> <spec/index.md>` resolves the project, runs in the worktree, and does no
  git ops).
- The behavioral/preservation AC anchor warnings — non-blocking and working as intended
  ([[refactor-acs-cite-tests]], [[plan-draft-structural-validation]]).

## References

- `v1/src/commands/plan.ts` — `assertNoCommitExternalSpecBoundary` / `appendBoundaryBlocker` /
  `cleanupNoCommitTempSpec` (advisory anchors ~`plan.ts:794-801`, ~`941-954`; confirm before
  editing).
- `v1/spec/completed/2026-05-20T17-09-09Z-plan-no-commit-skip-git-calls/intent.md` — prior intent
  that explicitly warns against false-positive boundary blockers and against running git
  write-detection on non-git/no-commit roots; this failure reads as a gap or regression there.
- `v1/spec/completed/2026-06-18T16-47-07Z-no-commit-plan-external-spec-write-access/` — the
  external-spec write-access + boundary design this should align with.
