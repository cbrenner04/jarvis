# 01 - Claude permission flags

## Problem

`claude -p` in its default permission mode prompts on file edits and Bash
commands. With no TTY, the run stalls and reports it is waiting for
permission. This is the symptom that motivated the spec.

## Decisions

- Pass `--permission-mode acceptEdits` on every `claude -p` invocation.
  - `acceptEdits` auto-accepts file edits and common filesystem commands
    (`mkdir`, `touch`, `mv`, `cp`) for paths under the cwd. It still prompts
    on Bash, which matches the `safe-edits` posture.
  - Destructive commands targeting `/` or `$HOME` still trip Claude's built-in
    circuit breaker even in `acceptEdits`, so we do not need an extra deny
    layer.
- Do not pass `--dangerously-skip-permissions`. Ever, from jarvis.
- Do not pass `--add-dir`. The agent's cwd is already the worktree root, so
  edits there are in scope by default.
- No `.claude/settings.json` is written to the target repo. Flags are the
  only mechanism.

## Tasks

- [ ] In `src/agents/claude.ts`, append `--permission-mode acceptEdits` to
      `argv` immediately after `-p` and before any model flag.
- [ ] Update the top-of-file comment to mention the permission flag and link
      to this subspec.
- [ ] Add a test in `test/` that constructs `ClaudeAgent`, spawns it against
      a stub binary (or asserts argv via a spawn mock), and verifies the flag
      is present.

## Acceptance criteria

- Running a spec that creates a file under the worktree no longer returns a
  "waiting for permission" message from `claude -p`.
- `claude -p` still blocks `rm -rf /` and `rm -rf ~` via its circuit breaker.
- The new test fails if `--permission-mode acceptEdits` is removed from the
  argv.
