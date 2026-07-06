# Default to direct handler invocation in test-writing.md

Docs-only. `v2/docs/test-writing.md`'s worked example (lines ~75-93) wires
`createRunControlHandlers`/`createTailStreamHandler` through `startIpcServer`
for every case, so authors copy a socket round-trip even when the assertion
never touches wire transport. Standardize on calling the returned handlers
in-process; reserve real sockets for transport coverage.

## Decisions

- Direct in-process handler invocation (call the object `createRunControlHandlers`/`createTailStreamHandler` returns directly, no socket) is the default pattern for daemon behavior tests — rules out continuing to default new tests to a socket round-trip.
- Socket round-trips are limited to three cases: the `ipc.test.ts` transport suite, at most 1-2 round-trip smokes per handler set (proving JSON marshaling survives the wire), and `.sandbox-unrunnable` smokes — rules out every other daemon test needing `startIpcServer`/`canUseUnixSockets()`.
- Determinism smell checklist gains a rule: a new agent-runnable test gated on `skipIf(!canUseUnixSockets())` is a defect unless it is one of the retained round-trip smokes above.

## Acceptance criteria

- [ ] `v2/docs/test-writing.md`'s worked example under "Do not reimplement production logic in test doubles" shows calling `createRunControlHandlers`/`createTailStreamHandler` directly in-process (no `startIpcServer`) as the expected pattern.
- [ ] `v2/docs/test-writing.md` states the socket-round-trip allowance is limited to: the `ipc.test.ts` transport suite, at most 1-2 round-trip smokes per handler set, and `.sandbox-unrunnable` smokes.
- [ ] `v2/docs/test-writing.md`'s "Determinism smell checklist" includes: a new agent-runnable test gated on `skipIf(!canUseUnixSockets())` is a defect unless it is one of the retained round-trip smokes.

## Documentation updates

- `v2/docs/test-writing.md` — replace the worked example and extend the smell checklist per the acceptance criteria above.
