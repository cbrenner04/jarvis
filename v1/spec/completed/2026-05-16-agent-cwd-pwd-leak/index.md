# Agent cwd / `PWD` leak into spawned agents

When jarvis spawns an agent CLI with `cwd` set to a per-spec worktree under
`<project>/.worktree/<spec>/`, the agent can end up operating on the parent
project repository instead of the worktree. This causes subspec commits on
the worktree branch to contain only the index-checkbox flip while the
agent's real file edits accumulate, uncommitted, in the parent repo's
working tree. The draft PR then shows "checkbox-only" commits and the
parent checkout becomes a dirty mash-up of every iteration's edits.

This was observed end-to-end with the `opencode` agent (v1.15.0) on the
`plan-mode-followups` run on 2026-05-15. PR #32 captured the empty
subspec commits; the implementation edits sat uncommitted on `main` in
the parent checkout.

## Root cause

Node's `child_process.spawn({ cwd })` changes the child process's working
directory but does **not** rewrite the `PWD` environment variable. The
child inherits the parent's `PWD` unchanged.

`opencode run` reads `process.env.PWD ?? process.cwd()` when no `--dir`
flag is passed (`packages/opencode/src/cli/cmd/run.ts:282` in the
upstream opencode repo) and pins all SDK requests to that directory via
the `x-opencode-directory` header. The in-process server middleware then
loads a *second* instance for the directory in `PWD` (the parent jarvis
repo) in addition to the worktree instance created from the real cwd, and
the session is stored against the parent repo. File-edit tool calls run
through that session and land in the parent.

Other agents may or may not exhibit the same behavior today. The fix
should be agent-agnostic so a future agent that also reads `PWD`,
`OLDPWD`, or a similar shell convention does not regress us.

## Scope

This spec covers a single, tightly bounded fix in the harness's spawn
layer and one optional belt-and-suspenders flag for `opencode`. It is
**not** about relocating worktrees outside the parent repo (a much
larger change discussed and discarded in favor of this fix).

- [x] [00 - Normalize `PWD` and pass `--dir` for spawned agents](./00-normalize-pwd-and-opencode-dir.md)
