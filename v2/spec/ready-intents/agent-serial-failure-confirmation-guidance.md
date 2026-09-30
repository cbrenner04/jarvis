---
name: agent-serial-failure-confirmation-guidance
---

# Agent guidance uses live serial confirmation

## Problem

`AGENTS.md` / `CLAUDE.md` still instruct agents to confirm scoped test failures with bare `bun test`, which conflicts with the frozen-`v1/` rule and produced untrustworthy burn-down reruns.

## Behavior

Replace the bare `bun test` serial-confirmation instruction with `bun run test:confirm:live` (aggregate live roster, serial — not a repeat of the failing scoped `test:*` slice). Keep the rule that only a serially reproducing failure is real; preserve scoped-first testing and failing-test evidence semantics.

## Acceptance criteria

- [ ] `shared/prompts/implement-prompts.test.ts` test `the migrated jarvis-specific rules live in this repo's injected guidance` fails against the pre-fix guidance and asserts `bun run test:confirm:live` instead of bare `bun test`.
- [ ] `AGENTS.md` and `CLAUDE.md` no longer tell agents to run bare `bun test` for serial failure confirmation.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — agent mid-work serial retry (~209) and implement-rules catalog entry (~440) cite `bun run test:confirm:live`, not bare `bun test` in `AGENTS.md`.
- `v2/docs/prompts.md` — jarvis-specific serial confirmation lives in `AGENTS.md` via `test:confirm:live`.

## Prerequisites

- `package.json` exposes `test:confirm:live` running every live test surface serially with no discovery under frozen `v1/`.
