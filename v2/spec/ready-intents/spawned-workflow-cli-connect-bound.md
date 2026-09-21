---
name: spawned-workflow-cli-connect-bound
---

# Keep spawned workflow CLI tests clear of the flat five-second connect wall

## Module-boundary surface

- Spawned CLI test harness in `v2/src/commands/workflow.test.ts`.

## Problem

The detach-continuation and attached-entry-terminal tests launch a real CLI child that inherits the IPC client's unadjustable 5000 ms connect wall, despite the suite's 30000 ms test timeout.

## Behavior

- Spawned workflow CLI children inherit `connectIpcClient`'s 30000 ms default connection budget; they do not supply a different `nextFrame()` default.
- A child whose test-controlled connection completion exceeds its effective budget writes an `IPC connect timeout` with that budget to stderr; raising Bun's test timeout does not alter that outcome.

## Acceptance criteria

- [ ] A spawned-CLI regression holds the child's connection completion until 5001 ms, then releases it, and proves the child connects under the inherited 30000 ms budget; it fails against the pre-fix 5000 ms bound.
- [ ] A spawned-CLI regression holds the child's test-controlled connection completion past an explicit 10 ms budget and asserts stderr names `IPC connect timeout` and `10ms`, not a Bun test timeout; it fails against the pre-fix diagnostic.
- [ ] `v2/src/commands/workflow.test.ts` detach-continuation and attached-entry-terminal tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-practices.md` — explain that an exact 5000 ms spawned-CLI failure is the IPC connect bound, not the test timeout, and raising the test timeout cannot fix it.
- `v2/docs/v1-behaviors.md` — record the inherited 30000 ms spawned-CLI connection budget and distinct exhaustion diagnostic.

## Prerequisites

- `connectIpcClient` accepts an optional connection budget, defaults it to 30000 ms, and reports exhaustion as `IPC connect timeout` with its effective millisecond budget.
