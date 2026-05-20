# Intent

## Problem

`jarvis plan` against a registered non-git project with `modes.plan.commit: false` crashes after the draft phase completes. The completed [`2026-05-20T16-00-24Z-plan-no-commit-allows-non-git`](../completed/2026-05-20T16-00-24Z-plan-no-commit-allows-non-git/index.md) spec removed the early-return guard so plan mode now enters the main flow for non-git registered projects, but a few git invocations on `project.root` were not gated.

Observed run (cwd is non-git, `commit: false`):

```text
$ jarvis plan spec/wip-intents/i-need-a-new.md
plan: refine phase started
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
... (6 lines of leaked git stderr) ...
plan: refine: skipped
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
plan: draft phase completed
... uncaught exception ...
    at getCurrentBranch (/Users/chris.brenner/Work/jarvis/src/commands/plan.ts:2173:18)
    at planCommand (/Users/chris.brenner/Work/jarvis/src/commands/plan.ts:1670:26)
```

## Root cause

Two sites in `src/commands/plan.ts` still call git on `project.root` even when `commit === false`:

1. **`src/commands/plan.ts:1670`** — `const baseBranch = getCurrentBranch(project.root);` is unconditional, but every consumer of `baseBranch` (lines 1708, 1751, 1761, 1797, 1822, 1961, 1996, 2051, 2086) is already inside an `if (commit)` block. The variable is dead in commit-false runs; computing it crashes the harness on non-git roots.

2. **`assertTargetRepoPlanBoundary(project.root)` at `src/commands/plan.ts:1676`, `:1929`, `:2019`** — runs `git status` on `project.root` when commit is false. The function already catches the error and returns `{ ok: false, offendingPaths: ["(git status failed)"] }`, but:
   - `git`'s stderr leaks to the parent terminal because `execFileSync` with `stdio: "pipe"` and `encoding: "utf8"` in Bun does not consistently capture stderr.
   - Returning a synthetic "boundary violation" on non-git roots is incorrect: the function's purpose is to detect agent writes into `spec/` of the target repo. On a non-git target the historical write-detection mechanism (`git status`) doesn't apply, but the agent's working dir for commit-false runs is `~/.jarvis/specs/<project-safe-id>/<spec-dir>/`, not `project.root`, so the boundary is enforced by the agent's `cwd` argument rather than by status diffing. Producing a false-positive boundary blocker is worse than not checking.

Resume paths (lines 807, 892, 1004, 1025) also call `getCurrentBranch(project.root)` but are unreachable for `commit: false` runs (the resume guard at `src/commands/plan.ts:331` rejects no-commit resumes). They do not need changes here.

## Scope

Gate the remaining git calls so commit-false runs against non-git roots complete end-to-end without crashing and without leaking `fatal:` lines to the terminal. Do not extend support to unregistered non-git directories — project resolution still requires a registered entry or a `.git` ancestor.

## Out of scope

- Changes to `src/resolve-project.ts` (ad-hoc resolution still requires `.git`).
- Changes to the `commit: false` `--resume` guard.
- Reworking `assertTargetRepoPlanBoundary` to detect writes on non-git roots via filesystem snapshots. The agent's `cwd` is already constrained to the external spec dir for commit-false runs; the boundary check on `project.root` was added defensively and can be a no-op when the target is non-git.
