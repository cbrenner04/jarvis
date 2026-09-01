---
name: v2-implement-prompt-wiring
---

# v2 implement prompt id wiring

## Primary implementation surface

- v2 execution-loop implement write path in `v2/src/execution/` and `shared/prompts/review-implement.ts`

## Prerequisites

- `implement.prompt.body` and `implement.rules` are registered; `patch.prompt.body` and `patch.rules` are absent from the registry.

## Problem

- v2 implement workflow, write loop, CLI workflow admission, and shared review-implement rendering still reference `patch.prompt.body` and `patch.rules` at call sites that should own implement ids.

## Behavior

- Every v2 production and shared call site that drives implement write steps resolves `implement.prompt.body` and `implement.rules` instead of the retired patch ids; the `PATCH_RULES` placeholder key is unchanged.
- Implement-specific branching keyed on `patch.prompt.body` (mutation verification, coverage advisory, blocker contract, checkpoint subjects) keys on `implement.prompt.body` instead.

## Decision ledger

- Update id strings only at v2/shared call sites; rules out duplicating prompt assembly logic or changing render inputs beyond the id swap.
- Preserve existing implement write-loop semantics (landing, mutation verification, coverage advisory, publication); rules out behavior changes bundled into the id migration.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner-core.test.ts` implement step-array tests pin `implement.prompt.body` as the implement write prompt id; they fail against the pre-fix `patch.prompt.body` wiring.
- [ ] `v2/src/execution/write.test.ts` implement-path render and blocker-contract tests drive `implement.prompt.body`; they fail against pre-fix `patch.prompt.body` references.
- [ ] `shared/prompts/review-implement.ts` review actuator assembly uses `implement.prompt.body` and `implement.rules`; existing review-implement render tests stay green.
- [ ] Grep-level absence of `patch.prompt.body` and `patch.rules` in `v2/src/execution/` and `shared/prompts/review-implement.ts` production paths, pinned by a structural test or the above render tests.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record v2 implement write path prompt id wiring.
