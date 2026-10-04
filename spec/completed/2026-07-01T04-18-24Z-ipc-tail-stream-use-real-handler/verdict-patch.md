## Verdict

### Required outcomes

1. **Tail IPC servers must close on every exit path.** Each tail-log test starts a dedicated `tailServer` via `startTailServer`, but `withTailTest` only tears down `stateStore` and `LOGS_PATH` in `finally`; `tailServer.close()` runs only on the happy path inside the test body. If a connection error or assertion fails after the server binds, the tail server can remain open until a later test’s `rmSync`. The spec requires per-test isolated tail servers; isolation is incomplete without guaranteed teardown on failure paths. **Outcome:** every tail-log test must ensure its tail IPC server is closed in a `finally` (or equivalent) that runs regardless of pass/fail — same reliability bar as `daemon-tail-stream.test.ts`’s `afterEach` server close.

### Upheld but not required

- **Dual-server lifecycle** — Intentional per spec (per-test `tailServer` overriding suite `server` on a shared socket path). No restructure required; outcome #1 addresses the failure-mode leak without reopening that decision.
- **Abort test without `followCalled`** — AC is met: `followSignal` stays `undefined` if `follow` never runs, so the abort assertion still fails on regression. Matches `daemon-tail-stream.test.ts`. Optional hardening, not a verdict requirement.
- **Replay depth, helper duplication, uncovered guard matrix, misleading unknown-run test name, unclosed log readers** — Spec-aligned tradeoffs or cosmetic nits; no actuator action.

### Rationale

All acceptance criteria are satisfied: tail tests wire `createTailStreamHandler` over injected fakes, fixtures match production `loadRun` gating, behavioral assertions (replay order, unknown-run no-data/no-follow, abort signal) are correct, and `test-writing.md` documents the pattern. The single upheld gap is test infrastructure reliability under failure — not production semantics — but it directly undermines the spec’s per-test isolation decision and can leave bound sockets across failed runs.
