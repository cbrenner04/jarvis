---
name: implement-rules-forbid-history-rewrite
---

# Implement step rules forbid agent git history mutation

## Problem

`prompts/implement/rules.md` applies only to implement write steps (`IMPLEMENT_WRITE_STEP_RULES`); ready-repair uses `DEFAULT_WRITE_STEP_RULES` only (`write.test.ts`). It forbids commits but not rebase, reset, amend, merge, or push, so implement agents rewrite lane history despite Jarvis owning publication integration.

## Decisions

- Extend the implement commit rule: do not rebase, merge, reset, amend, or push; Jarvis owns history and base integration.
- Bump `implement.rules` fragment revision.

## Acceptance criteria

- [ ] Rendered implement write-step rules (`write-prompt.test.ts` / `IMPLEMENT_WRITE_STEP_RULES`) include the history-mutation prohibition and fail against the pre-fix `prompts/implement/rules.md`; ready-repair prompt assembly (`write.test.ts` / `DEFAULT_WRITE_STEP_RULES` only) is unchanged.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — rules revision note for the history-mutation prohibition (implement fragment only).

## Primary implementation surface

- `prompts/implement/rules.md`

## Prerequisites

- Iteration-head guard from `revert-write-step-history-rewrite` is observable in committed code (e.g. pre-iteration `HEAD` check in `v2/src/execution/`).
