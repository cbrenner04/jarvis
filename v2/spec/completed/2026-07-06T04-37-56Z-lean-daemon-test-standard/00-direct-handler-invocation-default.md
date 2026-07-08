# Default to direct handler invocation in test-writing.md

Docs-only. `v2/docs/test-writing.md`'s worked example (lines ~75-93) wires
`createRunControlHandlers`/`createTailStreamHandler` through `startIpcServer`
for every case, so authors copy a socket round-trip even when the assertion
never touches wire transport. Standardize on calling the returned handlers
in-process; reserve real sockets for transport coverage. Line 37's citation of
`daemon-start-list.test.ts` as a blessed agent-runnable socket example
contradicts the new cap and must be reframed alongside it.

## Decisions

- Direct in-process handler invocation (call the object `createRunControlHandlers`/`createTailStreamHandler` returns directly, no socket) is the default pattern for daemon behavior tests — rules out continuing to default new tests to a socket round-trip.
- A "handler set" is one exported handler factory: `createRunControlHandlers` is one set, `createTailStreamHandler` is another — rules out an ambiguous per-file or per-suite reading of the cap.
- Socket round-trips are limited to, additively: (a) the `ipc.test.ts` transport suite, (b) at most 1-2 round-trip smokes per handler set (proving JSON marshaling survives the wire), and (c) `.sandbox-unrunnable` smokes — rules out every other daemon test needing `startIpcServer`/`canUseUnixSockets()`. `ipc.test.ts` exercising `createTailStreamHandler` through `startIpcServer` counts only against allowance (a), not against `createTailStreamHandler`'s per-handler-set budget in (b).
- The standard applies to new tests going forward; it does not require migrating `daemon-start-list.test.ts` (29 existing socket cases) or `daemon-tail-stream.test.ts` (5 existing socket cases) — rules out reading the doc as retroactively flagging those files as defects.
- Determinism smell checklist gains a rule naming the three allowances (a)-(c) inline: a new agent-runnable test gated on `skipIf(!canUseUnixSockets())` is a defect unless it is the `ipc.test.ts` transport suite, a 1-2-per-handler-set round-trip smoke, or a `.sandbox-unrunnable` smoke.

## Acceptance criteria

- [x] `v2/docs/test-writing.md`'s worked example under "Do not reimplement production logic in test doubles" shows calling `createRunControlHandlers`/`createTailStreamHandler` directly in-process (no `startIpcServer`) as the expected pattern.
- [x] `v2/docs/test-writing.md` states the socket-round-trip allowance is limited to, additively: the `ipc.test.ts` transport suite, at most 1-2 round-trip smokes per handler set (one budget per exported handler factory), and `.sandbox-unrunnable` smokes; and states `ipc.test.ts` counts only against its own transport-suite allowance, not against `createTailStreamHandler`'s per-handler-set budget.
- [x] `v2/docs/test-writing.md`'s line-37-area text (the `canUseUnixSockets` shared-fixture section citing `daemon-start-list.test.ts`) no longer holds it up as a general blessed example; it is reframed as a pre-existing test the new standard does not require migrating.
- [x] `v2/docs/test-writing.md` states the new standard applies to new tests going forward and does not require migrating `daemon-start-list.test.ts` or `daemon-tail-stream.test.ts`.
- [x] `v2/docs/test-writing.md`'s "Determinism smell checklist" includes a rule naming the three retained allowances inline (`ipc.test.ts` transport suite; 1-2 round-trip smokes per handler set; `.sandbox-unrunnable` smokes): a new agent-runnable test gated on `skipIf(!canUseUnixSockets())` is a defect unless it is one of those three.

## Documentation updates

- `v2/docs/test-writing.md` — replace the worked example, reframe the line-37-area `daemon-start-list.test.ts` citation, add the not-retroactive sentence, and extend the smell checklist per the acceptance criteria above.
