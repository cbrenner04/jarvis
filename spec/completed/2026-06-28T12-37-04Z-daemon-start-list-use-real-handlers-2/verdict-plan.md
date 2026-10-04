- Refine the subspec so migrated assertions track real `createRunControlHandlers` behavior, not today’s copied-test behavior. The current draft says to keep existing IPC assertions, but the intent is to test the real handler path; if existing expectations diverge from shipped handler semantics, the spec must require correcting them rather than preserving stale coverage.

- Clarify the fake executor’s teardown contract on abort. The draft requires deterministic settlement and no teardown hangs, but it does not pin what happens when teardown aborts in-flight work. The spec should require an abort path that settles background work without surfacing unhandled rejections, because the handler factory spawns write-loop work fire-and-forget and the review goal is stable teardown, not replacing hangs with flaky async failures.

- Preserve observable pause/kill signal behavior, not just RPC envelopes. Since this slice migrates tests onto the real handler factory, the spec should require that the injected fake executor exposes whether pause and abort signals were triggered and that the tests keep asserting that observable contract. Otherwise the migration could lose the only coverage that the handlers drive the injected control signals correctly.


