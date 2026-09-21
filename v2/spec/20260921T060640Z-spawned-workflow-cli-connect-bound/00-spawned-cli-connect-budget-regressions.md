# Spawned CLI connect-budget regressions

## Problem

Spawned workflow CLI children in `v2/src/commands/workflow.test.ts` (`spawnWorkflowCliChild`) must connect under `connectIpcClient`'s inherited 30000 ms default, and budget exhaustion must surface as `IPC connect timeout`, not a Bun test timeout. No test pins either.

## Decisions

- The child script keeps passing `connectIpcClient` unwrapped by default; an optional env var (e.g. budget override) makes the child pass an explicit `connectTimeoutMs` — rules out hardcoding a budget in the child that would shadow the 30000 ms default.
- Connection hold is test-controlled at the socket (e.g. a listener/proxy that accepts only after a delay), not a sleep before calling `connectIpcClient` — a pre-call sleep would not exercise the budget.
- Deferred to first consumer: exact hold mechanism and env var name — pin when implementing.
- No production code change unless the regression exposes one; `v2/src/cli/stale-dispatch.ts` `CONNECT_DEADLINE_MS` is out of scope unless the child path hits it.

## Tasks

- [ ] Add an optional budget-override env to the spawned child script.
- [ ] Add a held-connection helper releasing at a test-chosen time.
- [ ] Add the two regressions below; per-test Bun timeout above 5001 ms for the inherited-budget case.
- [ ] Update docs.

## Acceptance criteria

- [ ] A spawned-CLI regression in `v2/src/commands/workflow.test.ts` holds the child's connection completion until 5001 ms, then releases it, and proves the child connects under the inherited 30000 ms budget; it fails against the pre-fix 5000 ms bound.
- [ ] A spawned-CLI regression holds the child's test-controlled connection completion past an explicit 10 ms budget and asserts stderr names `IPC connect timeout` and `10ms`, not a Bun test timeout; it fails against the pre-fix diagnostic.
- [ ] `v2/src/commands/workflow.test.ts` detach-continuation and attached-entry-terminal tests stay green.
- [ ] `v2/docs/operator-practices.md` states an exact 5000 ms spawned-CLI failure is the IPC connect bound, not the test timeout, and raising the test timeout cannot fix it.
- [ ] `v2/docs/v1-behaviors.md` records the inherited 30000 ms spawned-CLI connection budget and the distinct `IPC connect timeout` exhaustion diagnostic.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-practices.md` — 5000 ms spawned-CLI failure is the connect bound; test timeout can't fix it.
- `v2/docs/v1-behaviors.md` — inherited 30000 ms budget + exhaustion diagnostic.
