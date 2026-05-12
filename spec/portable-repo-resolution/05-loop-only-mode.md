# 05 - Loop-only mode (no worktree, no commits, no PR)

## Problem

When effective `git` is `false` (subspec 04), jarvis must run the agent loop
without any git or gh interaction: no worktree, no commits, no pushes, no
draft PR, no ready transition. Completion semantics also need to change since
the clean-tree check no longer applies.

## Decisions

- When effective `git` is `false`:
  - Skip worktree creation; the agent's `cwd` is the resolved project's
    `root`, or the value of `--cwd <dir>` if provided.
  - Skip per-subspec commit, push, draft PR open, and ready-on-complete.
  - Spec completion = zero unchecked boxes. The clean-tree check is not
    performed.
  - Exit code `6` (dirty worktree) cannot fire in this mode.
  - Worktree-related config (`worktreeSymlinks`) is ignored.
- When effective `git` is `true` and the resolved `cwd` is not a git
  checkout, `jarvis run` exits 1 with: `error: target is not a git checkout;
  set "git": false in config or pass --repo to a git checkout`.
- `--cwd <dir>` flag:
  - Only valid when effective `git` is `false`.
  - Must be an existing directory; otherwise exit 1.
  - When supplied, it replaces the resolved project root for the agent's
    `cwd` only. Spec resolution still proceeds normally.
  - Passing `--cwd` while effective `git` is `true` exits 1 with a message
    explaining the constraint.
- Iteration banner still prints project key and spec display name. When
  ad-hoc resolution from subspec 01 was used, the project key is the
  derived display key (the basename of the resolved root), not a registered
  name.
- Session log naming and log-server namespacing continue to use
  `<project-key>:<spec-name>` regardless of mode.

## Task Checklist

- [ ] Branch the run flow on the effective `git` value.
- [ ] Skip worktree, commit, push, PR open, and ready-on-complete in
  loop-only mode.
- [ ] Add `--cwd <dir>` flag with the validation rules above.
- [ ] Update completion check to skip the clean-tree requirement when
  appropriate.
- [ ] Tests covering: loop-only run completes on zero unchecked boxes; no
  worktree directory is created; no `git`/`gh` subprocesses are invoked;
  `--cwd` honored only when `git: false`; `git: true` against a non-git cwd
  exits 1; per-project override flips behavior independently of global.

## Acceptance criteria

- [ ] With effective `git: false`, `jarvis run` does not create a worktree
  under `.worktree/`.
- [ ] With effective `git: false`, `jarvis run` does not invoke `git commit`,
  `git push`, `gh pr create`, or `gh pr ready` for any subspec.
- [ ] With effective `git: false`, a spec with zero unchecked boxes exits 0
  even when files in the working directory are dirty or untracked.
- [ ] `--cwd <dir>` is accepted only when effective `git` is `false`; using
  it with `git: true` exits 1 with the documented message.
- [ ] When `--cwd <dir>` is supplied and valid, the agent runs with that
  directory as `cwd` and the iteration banner reflects it.
- [ ] With effective `git: true` and a resolved `cwd` that is not a git
  checkout, `jarvis run` exits 1 with the documented message before invoking
  any agent.
- [ ] Per-project override flips behavior for that project without affecting
  other projects.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` pass.

## Documentation updates

- `docs/run-loop.md`: document loop-only mode, the new completion rule when
  `git: false`, and the `--cwd` flag.
- `docs/worktrees-and-commits.md`: clarify that the entire document applies
  only when effective `git` is `true`; add a short note pointing at the
  loop-only mode for the alternative.
- `README.md`: add `--cwd` to the run usage block.
