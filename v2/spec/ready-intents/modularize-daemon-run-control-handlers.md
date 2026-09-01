---
name: modularize-daemon-run-control-handlers
---

# Modularize daemon run-control handlers

## Primary implementation surface

Daemon

## Problem

`createRunControlHandlers` is a single closure holding ~20 RPC handlers and nested helpers over shared mutable captured state; tests reach live runs through the `activeRunsByHandler` WeakMap back-channel.

## Behavior

- Introduce an explicit shared handler-context object constructed by the factory.
- Move each RPC handler group into its own module with direct unit tests.
- Delete `activeRunsByHandler` and `activeRunForHandler`; tests construct context directly.
- Keep `createRunControlHandlers` as wiring only; RPC contracts unchanged.

## Decision ledger

- Handler modules take explicit shared context; rules out WeakMap back-channels from handler return values to `activeRuns`.
- Behavior-preserving extraction only; rules out RPC contract changes riding along.
- Group handlers by RPC family (run lifecycle, workflow admission, pipeline); rules out one mega-module mirroring the old closure.

## Prerequisites

- Tail-stream and peer-socket discovery live outside the run-control handler closure in dedicated daemon modules.

## Acceptance criteria

- [ ] `activeRunsByHandler` and `activeRunForHandler` are absent from `v2/src/daemon/` (reachable on merge-base via `daemon.ts:165–169`, consumed in `daemon-workflow-start.test.ts` and `daemon-pipeline-recover.test.ts`).
- [ ] `v2/src/daemon/daemon-run-control-handler-guard.test.ts` fails when `activeRunsByHandler` or `activeRunForHandler` is reintroduced in `v2/src/daemon/`; passes on the clean tree.
- [ ] Each handler-group module has co-located direct tests; existing daemon integration tests stay green when re-pointed.
- [ ] `v2/src/daemon/daemon-test-inventory.test.ts` merge-base-to-branch comparison reports equal case counts and unchanged test titles across `v2/src/daemon/**/*.test.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — handler module map.
- `v2/docs/test-writing.md` — constructing the daemon handler context in tests.
