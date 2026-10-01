---
name: implement-rules-forbid-history-rewrite
---

# Implement step rules forbid agent git history mutation

## Problem

`prompts/implement/rules.md` forbids commits but not rebase, reset, amend, merge, or push, so agents rewrite lane history despite Jarvis owning publication integration.

## Decisions

- Extend the commit rule: do not rebase, merge, reset, amend, or push; Jarvis owns history and base integration.
- Bump `implement.rules` fragment revision.

## Acceptance criteria

- [ ] Rendered implement write-step rules include the history-mutation prohibition; pinned by `v2/src/execution/write-prompt.test.ts` and fails against the pre-fix `prompts/implement/rules.md`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — rules revision note for the history-mutation prohibition.

## Primary implementation surface

- `prompts/implement/rules.md`

## Prerequisites

- Before fence, autofix, or commit on every write-step agent return (implement iteration and ready repair), when post-iteration `HEAD` is not a descendant of the recorded pre-iteration `HEAD`, the harness resets to the pre-iteration SHA with `git reset --keep`, logs `agent_history_rewrite_reverted`, and continues the iteration, or settles resumable `completion_commit_failed` naming both SHAs when reset fails.
- Agent-created commits that only extend lineage from the pre-iteration `HEAD` are not treated as history rewrites.
