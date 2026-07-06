---
name: v2-in-process-daemon-tests
---

# In-process daemon handler tests + one shared harness

Six daemon test files each boot a real unix-socket server + SQLite + a copy-pasted ~40-line harness to reach handlers that are plain injectable functions — and all of it silently skips in the agent sandbox. Convert to direct handler invocation and consolidate the four separately-implemented fakes. Mechanism conversion only: the set of behaviors covered does not shrink here (that is seed 10).

## Decisions

- **Convert to direct invocation** of handlers from `createRunControlHandlers`/`createTailStreamHandler` (no socket, no `skipIf`): `daemon-start-list.test.ts`, `daemon-queue-promotion.test.ts`, `daemon-revise.test.ts`, `daemon-wait-run-completion.test.ts`, `daemon-run-failure-capture.test.ts`, `daemon-tail-stream.test.ts`. Remove per-file `SOCKET_PATH`/`rmSync`/`canUseUnixSockets` ceremony.
- **Retain socket coverage:** the `ipc.test.ts` framing/correlation/multi-client suite; 1–2 round-trip smokes over the run-control handler set (JSON marshaling of params/results); the `.sandbox-unrunnable` daemon smoke.
- **Consolidate in `v2/src/testing/`:** one `createFakeWriteLoopExecutor` (adopt the richest variant, daemon-start-list.test.ts:22-57 — settle/abort/pause introspection); one fake `IpcClient` (replaces cli.test.ts `makeClient`/`makeBlockingClient` and tui-daemon-client.test.ts `makeClient`/`createDeferredClient`); one `withFixedUuid` (cli/tui variants merge). Delete daemon-run-failure-capture's local re-implementations of `mockWriteLoopInput`/`startRun`/`listRuns` in favor of `testing/run-control.ts` (adapt those helpers for direct handler invocation).
- **Only src change:** `reviewDebateProgressByInvocation` (module-global mutable map, cleared in test afterEach) becomes an injected dep of the handler factory; the global export goes away.
- `tui-daemon-client.test.ts`: drop the socketTest round-trips (transport and daemon behavior owned elsewhere) except "rejects unreachable socket".

## Out of scope

- Deleting or thinning behavior coverage (seed 10).
- New testing helpers beyond the ones named.

## Verification

After this seed, `bun run test:v2` inside the agent sandbox reports **0 skips** (sandbox-unrunnable files are already excluded by the file slice). Test-count diff vs baseline documented in the PR body.

## Ordering

03 — after 02; before design seeds 05–09, whose daemon/CLI work then lands on the shared harness with sandbox-visible tests.
