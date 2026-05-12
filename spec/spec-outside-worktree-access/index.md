# Spec outside worktree access

repo: /Users/christopherbrenner/Work/jarvis

When a spec lives outside the repo named by its `repo:` line (umbrella-repo
layouts where shared `specs/` sits above the per-repo source trees), Jarvis
asks the agent to read a file outside the worktree. `claude -p
--permission-mode acceptEdits` will not auto-allow reads outside cwd, so the
run stalls on the first iteration with a "permission" message.

- [x] [00 - Grant claude read access to external spec dir](./00-claude-add-dir.md)
