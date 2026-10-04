# Continue a durable pipeline after restart

## Problem

- A restarted daemon has no production path that proves it can continue a durable pipeline without the original
  client or store handle.

## Decisions

- The production continuation path loads the persisted admission context and predecessor artifact before resolving
  the eligible workflow stage; rules out caller-supplied reconstruction.
- Continuation claims the pipeline for a live daemon and establishes its runnable pipeline state before dispatch;
  rules out dispatching a durable row without ownership or active state.

## Task checklist

- Add restart-safe continuation through the daemon execution path.
- Load context from the repository rather than the original admission request.
- Add focused restart and ownership coverage.
- Update daemon and v2 behavior docs.

## Acceptance criteria

- [x] After the admitting daemon process and store handle are gone, the production continuation path resolves and
      dispatches an eligible later workflow stage from persisted context and predecessor artifact without
      caller-supplied admission input.
- [x] Before that dispatch, continuation establishes one live pipeline owner and a runnable pipeline state; a
      competing continuation is refused without changing stage rows or creating a second dispatch.
- [x] A new or updated `v2/src/daemon/pipeline-execution.test.ts` regression for restart-safe production
      continuation fails against the pre-fix behavior.
- [x] Inverting the persisted-context load or continuation-claim guard makes its targeted regression fail; negative
      cases prove missing client input and losing claims cannot dispatch a workflow.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` document restart-safe continuation and its ownership
      semantics.

## Documentation updates

- `v2/docs/daemon-host.md` — continuation after daemon restart.
- `v2/docs/v1-behaviors.md` — additive v2 persisted-context continuation.
