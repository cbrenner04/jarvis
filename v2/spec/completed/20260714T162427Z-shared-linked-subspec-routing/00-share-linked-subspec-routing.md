# Share linked-subspec routing

## Problem

Linked-index routing is split between `v2/src/execution/linked-subspec-routing.ts`, implement-builder preflight, and state transitions inside `workflow-runner.ts`. Builders and execution can classify the same index differently, and the runner owns behavior beyond step coordination.

## Decisions

- Put selection, advancement, terminal detection, and named failure classification behind one `shared/` contract; rules out shared parsing helpers with runner-owned transitions.
- Make implement builders and execution consume the same contract; rules out separate preflight and runtime interpretations.
- Keep `v2/src/execution/workflow-runner.ts` as one file; rules out a runner file split as the extraction boundary.

## Work

- Add the shared linked-subspec routing contract and focused tests.
- Replace builder and runner routing logic with that contract; remove the v2-only duplicate.
- Keep the runner responsible for step execution and routing orchestration only.
- Align the durable workflow-runner architecture documentation.

## Acceptance criteria

- [x] `shared/**/linked-subspec-routing*.test.ts` covers direct subspec, empty index, completed index, malformed or unreadable links, active selection, advancement, terminal detection, and multiple subspecs through the shared contract.
- [x] `v2/src/execution/implement-workflow-steps.test.ts` stays green with builder preflight consuming the shared contract.
- [x] `v2/src/execution/workflow-runner.test.ts` linked-implement routing tests stay green with selection, advancement, terminal detection, and failure classification removed from runner ownership.
- [x] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/workflow-runner.md` identifies `shared/` as linked-subspec routing owner and limits `workflow-runner.ts` to coordination.

## Documentation updates

- `v2/docs/workflow-runner.md` — shared routing ownership and thin-runner boundary.
