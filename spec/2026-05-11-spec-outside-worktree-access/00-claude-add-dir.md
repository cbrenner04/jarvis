# 00 - Grant claude read access to external spec dir

## Problem

`prepareActiveSpecPath` (src/commands/run.ts) only relocates the spec into the
worktree when the spec path is a descendant of `projectRoot`. In umbrella-repo
layouts the spec sits in a parent directory of the target repo, so
`relative(projectRoot, specPath)` starts with `..` and Jarvis leaves `specPath`
at its original location — outside the agent's cwd.

The prompt then instructs the agent to `Read the spec at <absolute path
outside cwd>`. `claude -p --permission-mode acceptEdits` does not auto-allow
reads outside cwd, so the model returns text like "I need permission to read
the spec file" and the iteration makes no progress.

Reproduction:
- spec: `/Users/.../groceries/specs/active/UI_REDESIGN/UI_REDESIGN_PHASE_4/index.md`
- spec `repo:` → `/Users/.../groceries/groceries-client`
- worktree: `groceries-client/.worktree/UI_REDESIGN_PHASE_4`
- spec dir is a sibling of `groceries-client`, not a descendant.

## Decisions

- When the resolved spec path is not inside `agentWorkingDir`, pass the spec's
  parent directory to `claude` via `--add-dir <dir>`. This grants read/edit
  access to the spec dir only; the agent's primary cwd remains the worktree.
- Update `Agent.run` to accept an optional `additionalReadDirs?: string[]` so
  the harness can express the requirement once and each agent maps it to its
  CLI's equivalent flag. Today only `ClaudeAgent` consumes it; other agents
  accept and ignore it.
  - Codex (`--sandbox workspace-write`): reads outside the workspace are
    permitted by the sandbox, so no flag is required.
  - Cursor (`--force`, `--workspace <cwd>`): full tool access; no flag
    required for reads.
  - Opencode: permissions live in `~/.config/opencode/opencode.json`; no flag
    required.
- Do not change `prepareActiveSpecPath` to copy external specs into the
  worktree — the spec dir often contains state (subspecs, history) that the
  agent must update in place.
- Amend `spec/2026-05-11-permissions/01-claude-flags.md` to note this single, narrow
  exception to the "Do not pass `--add-dir`" rule.

## Tasks

- [x] Extend `Agent.run` opts in `src/agents/types.ts` with
      `additionalReadDirs?: string[]`.
- [x] In `src/agents/claude.ts`, append `--add-dir <dir>` for each entry
      after `--permission-mode acceptEdits` and before `--model`.
- [x] In `src/commands/run.ts`, when `specPath` is not a descendant of
      `agentWorkingDir`, pass `additionalReadDirs: [dirname(specPath)]` to
      `agent.run` for every agent invocation in the run loop (including the
      PR-body generator call).
- [x] Update `src/agents/codex.ts`, `src/agents/cursor.ts`,
      `src/agents/opencode.ts` to accept the new opts shape without changing
      behavior.
- [x] Add a test in `test/agents/claude.test.ts` asserting `--add-dir <path>`
      is present when `additionalReadDirs` is set.
- [x] Add a test in `test/run.test.ts` that uses a spec whose `repo:` points
      to a subdirectory and asserts the fake agent receives
      `additionalReadDirs` containing the spec's parent directory.
- [x] Update `spec/2026-05-11-permissions/01-claude-flags.md` to document the narrow
      `--add-dir` exception for specs outside the worktree.

## Acceptance criteria

- Running `jarvis run` against a spec whose `repo:` resolves to a sibling
  directory no longer stalls on "permission to read the spec file".
- `claude` argv includes `--add-dir <spec-dir>` only when the spec is outside
  the worktree; argv is unchanged for in-worktree specs.
- `bun run typecheck`, `bun test`, and `bun run lint` pass.
