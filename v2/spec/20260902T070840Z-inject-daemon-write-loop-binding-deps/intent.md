---
name: inject-daemon-write-loop-binding-deps
---

# Inject daemon write-loop binding dependencies

## Primary implementation surface

Daemon

## Problem

`writeLoopBindingSourceDeps` and its `set/resetWriteLoopBindingSourceDepsForTests` pair are module-level mutable globals in production `daemon.ts`; tests are the only writers.

## Behavior

- Replace the module globals with injected deps on the production write-loop binding-resolution path.
- Delete the `...ForTests` setters; re-point daemon and execution tests at explicit injection seams.

## Decision ledger

- Constructor/argument injection replaces module-level assignment; rules out retaining production globals whose only writers are tests.
- Keep binding resolution on the existing daemon-owned path; rules out moving resolution into execution-loop callers.

## Prerequisites

## Acceptance criteria

- [ ] `v2/src/daemon/write-loop-binding-source-guard.test.ts` and `v2/src/daemon/write-loop-codex-sandbox-mode.test.ts` stay green with injection-only setup (no `setWriteLoopBindingSourceDepsForTests`).
- [ ] `v2/src/execution/workflow-runner.test-support.ts` consumers pin binding overrides through the injection seam.
- [ ] `v2/src/daemon/daemon.ts` exports no `setWriteLoopBindingSourceDepsForTests` or `resetWriteLoopBindingSourceDepsForTests`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates
