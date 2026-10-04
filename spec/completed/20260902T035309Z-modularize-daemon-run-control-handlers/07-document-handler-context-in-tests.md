# Document handler context in tests

## Problem

`v2/docs/test-writing.md` documents calling `createRunControlHandlers` with injected fakes but not constructing `RunControlHandlerContext` directly now that `activeRunForHandler` is gone, leaving agents to rediscover the pattern from test diffs.

## Decision ledger

- `test-writing.md` owns the worked example for context-plus-handlers construction; rules out a second example in `daemon-host.md`.
- Integration tests read `handlers.context.activeRuns` from the `createRunControlHandlers` return seam; direct handler-module unit tests may call `createRunControlHandlerContext` in isolation; rules out documenting the deleted WeakMap back-channel or parallel context construction in integration tests.
- Preserve the existing factory-over-fakes guidance; rules out replacing the `createRunControlHandlers` example—extend it with the context seam and correct wire keys.

## Task checklist

- [ ] Extend the "Worked example: daemon run-control handler drift" section with `handlers.context.activeRuns` for integration assertions and a short direct `createRunControlHandlerContext` example for handler-module unit tests.
- [ ] Correct the worked example's `handlers.startRun` call to `handlers.start` (wire key in `handlersOut`).
- [ ] Remove or update any `activeRunForHandler` mention if present after subspec 04.

## Acceptance criteria

- [x] `v2/docs/test-writing.md` documents `handlers.context.activeRuns` from `createRunControlHandlers` for integration tests and direct `createRunControlHandlerContext` for handler-module unit tests; the worked example uses `handlers.start`, not `handlers.startRun`.

## Documentation updates

- `v2/docs/test-writing.md` — constructing the daemon handler context in tests.
