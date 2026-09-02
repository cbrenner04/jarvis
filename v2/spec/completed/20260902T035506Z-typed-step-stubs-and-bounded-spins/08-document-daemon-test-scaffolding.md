# Document daemon test scaffolding

## Problem

Operators and agents writing daemon pipeline tests lack durable guidance for typed dispatch stubs and bounded microtask synchronization; the #3060 hang is not recorded as a cautionary case. `v2/docs/test-writing.md` documents `write-fixtures.ts` but not `workflow-step-fixtures.ts` / `createWriteStep`.

## Surface

`v2/docs/test-writing.md`.

## Decisions

- Document `createMinimalDispatchWriteStep` and `writeStepFixtures().createWriteStep` under the shared fixtures section, cross-linking [`write-fixtures.ts`](../src/testing/write-fixtures.ts); rules out duplicating the full factory signature in specs.
- Extend § Deterministic daemon and execution tests with `spinUntilMicrotask` as a named third sync category (iteration-cap microtask spin), with explicit contrast to deadline-bound `setImmediate` / `setTimeout` polling already described; cite #3060 as the cautionary hang case; rules out prescribing changes to deadline-bound polls and rules out `guard-deterministic-daemon-tests.ts` extension (docs-only prevention).
- No production behavior change; rules out v1-behaviors.md updates.

## Task checklist

- Under shared fixtures, document `workflow-step-fixtures.ts`: `createMinimalDispatchWriteStep` (dispatch-only stubs) and when to prefer `writeStepFixtures().createWriteStep` (binding/worktree-heavy cases); cross-link `write-fixtures.ts`.
- In § Deterministic daemon and execution tests, add `spinUntilMicrotask` as the third sync category alongside bounded condition polling and sleep-as-wait, cross-linking the deadline-bound `setImmediate` example.
- Note the #3060 silent-hang failure mode for unbounded `Promise.resolve()` yield loops.

## Acceptance criteria

- [x] `v2/docs/test-writing.md` documents `createMinimalDispatchWriteStep`, `writeStepFixtures().createWriteStep`, `spinUntilMicrotask`, the choice versus deadline-bound `setImmediate` polling, and the #3060 unbounded-`Promise.resolve()` hang caution.
- [x] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/test-writing.md` — `workflow-step-fixtures.ts` minimal dispatch factory, `createWriteStep`, `spinUntilMicrotask` as third sync category, versus deadline-bound polling, and #3060 caution.
