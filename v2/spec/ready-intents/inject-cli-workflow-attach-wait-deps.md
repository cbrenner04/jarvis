---
name: inject-cli-workflow-attach-wait-deps
---

# Inject CLI workflow attach-wait dependencies

## Primary implementation surface

CLI

## Problem

`commands/workflow.ts` carries `forceSkipAttachClientWaitForTest` and `attachWaitRunIdOverrideForTest` module lets with exported setters consumed on the real workflow command path.

## Behavior

- Replace the globals with injected deps on the production workflow command entry.
- Delete the `...ForTest` setters; re-point workflow CLI tests at explicit injection.

## Decision ledger

- CLI tests supply attach-wait overrides through injected deps; rules out module-level mutable flags on the production workflow command path.

## Prerequisites

## Acceptance criteria

- [ ] `v2/src/commands/workflow.test.ts` detach and attach-wait cases stay green using injected deps only.
- [ ] `v2/src/commands/workflow.ts` exports no `setForceSkipAttachClientWaitForTest` or `setAttachWaitRunIdOverrideForTest`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates
