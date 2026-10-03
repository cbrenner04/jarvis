---
name: tick-blocker-token-move-into-tools
---

# Criterion tick, blocker, and terminal token are tools, not prompt rules

> Hold: owner sign-off required before `plan`; the seed was marked not dispatchable and this split records the proposed direction only.

## Problem

`prompts/implement/rules.md` carries the mechanics for ticking acceptance criteria, declaring a blocker, and emitting the terminal token; the harness verifies them only after the iteration ends.

## Decisions

- Tick, blocker, and terminal-token become tools that validate at the call (criterion exists and is unchecked; blocker shape; token state) so the contract is enforced where the action happens; the prompt rules shrink to what tools cannot enforce.
- Commit and publication ownership stay in the harness; a tool's presence does not authorize Git mutations, and authorization derives from the role and active task at execution.
- Plan must decide which mechanic moves first and how the prompt rules are trimmed in step.

## Prerequisites

- A tool server dispatches tool calls for the run (delivered by: harness-tool-server-serves-role-scoped-tools)

## Acceptance criteria

- [ ] `implement-tools.test.ts`: a tick of an unknown or already-checked criterion is refused by name; a valid tick edits only that checkbox; blocker and token calls validate their shape; fails against current code.
- [ ] `prompts/implement/rules.md` no longer instructs the moved mechanics, pinned by the prompt-registry tests.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — mechanics enforced at the tool boundary and remaining prompt obligations.

## Primary implementation surface

- `v2/src/execution/implement-tools.ts` (new), `prompts/implement/rules.md`
