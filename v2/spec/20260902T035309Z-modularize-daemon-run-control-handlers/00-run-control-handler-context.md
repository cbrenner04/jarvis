# Run-control handler context

## Problem

`createRunControlHandlers` owns shared mutable state (`activeRuns`, `waitAbortControllers`, `retiring`, review-progress maps, workflow promise tracking, promotion settle state, registry binding) as closure locals; tests cannot reach `activeRuns` without the `activeRunsByHandler` WeakMap back-channel (`daemon.ts:170–175`, consumed in `daemon-workflow-start.test.ts` and `daemon-pipeline-recover.test.ts`).

## Decision ledger

- New module `v2/src/daemon/daemon-run-control-context.ts` exports `RunControlHandlerContext`, `RunControlHandlerContextDeps`, and `createRunControlHandlerContext`; rules out leaving shared state as closure locals inside `createRunControlHandlers`.
- Context construction takes the same injectable deps as today's factory minus per-handler wiring; rules out a second parallel dependency bag for handler modules.
- `createRunControlHandlers` builds one context per invocation, passes it into handler factories added in later subspecs, and exposes it on the returned handler object as `context`; rules out parallel `createRunControlHandlerContext` calls in integration tests that could diverge from handler mutations.
- Handler RPC contracts and returned handler-map shape stay unchanged in this slice; rules out RPC or export-surface changes while introducing context.
- `activeRunsByHandler` / `activeRunForHandler` stay until subspec 04; rules out deleting the WeakMap before downstream tests are repointed.

## Task checklist

- [ ] Add `daemon-run-control-context.ts` with `RunControlHandlerContext` holding today's shared mutable fields and `createRunControlHandlerContext(deps)`.
- [ ] Refactor `createRunControlHandlers` to allocate context once, read shared state through it, and attach `context` to the returned handler object; keep handler bodies inline for now.
- [ ] Add `daemon-run-control-context.test.ts` with a direct context-construction test that reads `activeRuns` without `activeRunForHandler`.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-run-control-context.test.ts` constructs context via `createRunControlHandlerContext` and reads `activeRuns` without `activeRunForHandler`; it fails against the pre-fix tree where no context export exists.
- [x] `v2/src/daemon/daemon-start-list.test.ts` stays green (behavior unchanged by the context introduction).
- [x] `bun run typecheck` passes.

## Documentation updates

None — internal refactor scaffolding only; durable handler-test guidance lands in subspec 07.
