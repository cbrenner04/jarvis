---
name: name-destroyed-artifacts-when-a-run-fails-after-retirement
---

# Name destroyed artifacts when a run fails after retirement

## Problem

When a workflow invocation fails after retirement has begun, the operator gets the failure message
alone. What was already destroyed is only inferable from interleaved `Closed PR #…` / `Removed
worktree:` / `Deleted … branch:` progress lines, which scroll away and are absent when retirement
aborted partway. Recovery starts with the operator guessing which artifacts still exist.

## Decisions

- On any non-zero exit reached after retirement started, emit a closing stderr summary naming the
  artifacts actually destroyed. Rules out a bare failure message, and rules out relying on the
  in-progress stdout lines as the record.
- Summarize only what was destroyed in this invocation, from observed step outcomes. Rules out
  re-probing GitHub or git to reconstruct state.
- Emit nothing extra when the invocation succeeds or fails before retirement started. Rules out an
  unconditional summary line.

## Acceptance criteria

- [ ] A failure after retirement started prints a stderr summary naming each destroyed artifact (PR
      number, worktree path, local branch, remote branch) and omitting artifacts that survived.
- [ ] A failure before retirement started prints no such summary.
- [ ] A successful dispatch prints no such summary.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § stale-workspace retirement — the destroyed-artifact summary and
  how to recover from it.

## Prerequisites

- Workspace retirement can fail partway, leaving some artifacts destroyed and others intact.
