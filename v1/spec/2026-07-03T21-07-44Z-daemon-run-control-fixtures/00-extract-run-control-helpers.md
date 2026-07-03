# Extract daemon run-control test helpers

`daemon-start-list.test.ts` defines `mockWriteLoopInput`, `startRun`, and `listRuns` inline. These are generic IPC request-shaping helpers, not assertion-specific setup: they already operate on an `IpcClient` and a `WriteLoopInput`, not on any fake executor or state-store wiring, so extracting them separates generic shaping from the file's scenario-specific setup.

## Decisions

- Move `mockWriteLoopInput`, `startRun`, `listRuns` into `v2/src/testing/run-control.ts`; keep assertion-specific setup (fake executor, per-test state-store wiring) in `daemon-start-list.test.ts` — rules out moving test-scenario logic out of the file.
- Helpers take an `IpcClient` (from `connectIpcClient`) and `WriteLoopInput` overrides as parameters — no embedded fake executor or handler instance — so they stay reusable without coupling back to this file's setup.
- Migrate only `daemon-start-list.test.ts` to import the shared helpers; rules out touching other daemon test files in this subspec.
- Keep tests wired through production `createRunControlHandlers`; rules out reintroducing inline handler doubles.
- `canUseUnixSockets()` (`v2/src/testing/unix-socket.ts`) is confirmed as the shared socket-skip fixture — already used by `daemon-start-list.test.ts` and other daemon/tui test files; keep the existing `test.skipIf(!canUseUnixSockets())` usage as-is, rules out a second socket probe.
- No production code changes.

## Acceptance criteria

- [ ] `mockWriteLoopInput`, `startRun`, and `listRuns` are defined in `v2/src/testing/run-control.ts` and exported for reuse.
- [ ] `daemon-start-list.test.ts` imports these three helpers from `v2/src/testing/run-control.ts` instead of defining them locally, and still constructs handlers via production `createRunControlHandlers`.
- [ ] `bun run typecheck` passes.
- [ ] `daemon-start-list.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `v2/docs/test-writing.md` documents `v2/src/testing/run-control.ts` as the home for generic daemon run-control request helpers (`mockWriteLoopInput`, `startRun`, `listRuns`), distinguishing them from file-local scenario assertions.

## Documentation updates

- `v2/docs/test-writing.md`: add the daemon run-control helpers (`v2/src/testing/run-control.ts`) to the shared-fixtures guidance, alongside the existing `canUseUnixSockets` fixture description.
