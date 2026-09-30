---
name: agent-serial-failure-confirmation-guidance
---

# Agent guidance uses live serial confirmation

## Problem

`AGENTS.md` / `CLAUDE.md` still instruct agents to confirm scoped test failures with bare `bun test`, which conflicts with the frozen-`v1/` rule and produced untrustworthy burn-down reruns.

## Behavior

Replace the bare `bun test` serial-confirmation instruction with the live-surface confirmation script from `package.json`. Keep the rule that only a serially reproducing failure is real; preserve scoped-first testing and failing-test evidence semantics.

## Acceptance criteria

- [ ] `shared/prompts/implement-prompts.test.ts` test `the migrated jarvis-specific rules live in this repo's injected guidance` fails against the pre-fix guidance and asserts the new confirmation command string instead of bare `bun test`.
- [ ] `AGENTS.md` and `CLAUDE.md` no longer tell agents to run bare `bun test` for serial failure confirmation.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — agent mid-work serial retry cites the live confirmation command, not bare `bun test`.
- `v2/docs/prompts.md` — jarvis-specific serial confirmation lives in `AGENTS.md` via the named script.

## Prerequisites

- A `package.json` script runs every live test surface serially and never discovers tests under frozen `v1/`.
