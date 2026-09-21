---
name: spawned-workflow-cli-connect-bound
---

# Keep spawned workflow CLI tests clear of the flat five-second connect wall

## Module-boundary surface

- Spawned CLI test harness in `v2/src/commands/workflow.test.ts`.

## Problem

The detach-continuation and attached-entry-terminal tests launch a real CLI child that inherits the IPC client's unadjustable 5000 ms connect wall, despite the suite's 30000 ms test timeout.

## Behavior

- Both spawned children use the settled load-capable IPC connect policy while preserving their workflow assertions and `nextFrame()` behavior.
- A spawned child that exhausts the policy surfaces the IPC connect timeout and effective budget, so raising the Bun test timeout is not presented as a fix.

## Acceptance criteria

- [ ] A spawned-CLI regression delays connection beyond the current flat bound and proves the child remains governed by the settled load-capable connect policy; it fails against the pre-fix 5000 ms constant.
- [ ] A spawned-CLI regression exhausts the connect policy and asserts stderr names the IPC connect timeout and effective budget, distinguishable from a Bun test timeout.
- [ ] The existing detach-continuation and attached-entry-terminal workflow assertions stay green without changing what they assert.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-practices.md` — explain that an exact 5000 ms spawned-CLI failure is the IPC connect bound, not the test timeout, and raising the test timeout cannot fix it.

## Prerequisites

- IPC connection establishment uses a settled load-capable bound policy and reports exhaustion as an IPC connect timeout with its effective millisecond budget.
