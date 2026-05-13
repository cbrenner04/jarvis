# 03 - Point bail messages at `jarvis triage`

## Problem

`worktreeCompletionBlocker` in `src/worktree.ts` returns a short reason
string when a worktree fails the clean-tree check. Its callers in
`src/commands/run.ts` print that reason and exit, leaving the user with
a description of the problem but no guidance about what to do next.
With `jarvis triage` available, the bail messages can close the loop
with one extra line.

## Decisions

- Do not change `worktreeCompletionBlocker` itself. The function should
  remain a pure diagnostic — its callers compose the user-facing
  message.
- Two known caller sites (search `worktreeCompletionBlocker` in
  `src/commands/run.ts`):
  1. Spec-complete path: "spec checklists are complete, but
     {blocker}. Commit and push from the worktree so the PR updates.
     Worktree: {agentWorkingDir}"
  2. Iteration-edited-no-checks path: "iteration N edited files but
     checked no new acceptance criteria for {subspec}; {blocker}.
     Inspect the dirty worktree, then tick satisfied acceptance
     criteria, fix, or revert before rerunning. Worktree:
     {agentWorkingDir}"
- Both messages get one appended line:
  `Run \`jarvis triage <worktree-name>\` to inspect state and see suggested next moves.`
  The worktree name is the basename of `agentWorkingDir` (the directory
  jarvis itself created under `.worktree/`).
- The line is appended unconditionally — even when `agentWorkingDir`
  is not a real worktree under `.worktree/` (e.g. user passed
  `--cwd`). In that case the suggestion is harmless: `jarvis triage`
  with no matching worktree will simply report `unknown worktree`. The
  alternative — gating the suggestion on `.worktree/` membership — is
  more code for a marginal case.
- If new bail sites are added later, they should follow the same
  pattern. A comment near `worktreeCompletionBlocker` documents the
  expectation.

## Implementation hints

- Use `basename(agentWorkingDir)` from `node:path`.
- The appended string is a single line ending in `\n`; the existing
  caller strings already end in `\n` before this addition, so it
  becomes a second line.

## Task Checklist

- [ ] Append the triage suggestion at both `run.ts` call sites.
- [ ] Add a short comment above `worktreeCompletionBlocker` noting
  that callers are expected to append a triage suggestion.
- [ ] Update existing tests that assert exact bail-message text to
  include the new line.

## Acceptance criteria

- [ ] Both bail paths emit the triage suggestion as the last line
  before exit.
- [ ] The suggestion uses the basename of the worktree path.
- [ ] `worktreeCompletionBlocker`'s return value is unchanged.
- [ ] All existing tests for the two bail paths pass with the updated
  expected text.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- `docs/run-loop.md`: in whichever subsection describes the
  completion/iteration bails, mention that the bail message ends
  with a pointer to `jarvis triage`.
