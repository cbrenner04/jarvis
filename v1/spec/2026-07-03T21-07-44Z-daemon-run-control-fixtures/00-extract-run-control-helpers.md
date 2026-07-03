# Extract daemon run-control test helpers

`daemon-start-list.test.ts` defines `mockWriteLoopInput`, `startRun`, and `listRuns` inline. These are generic IPC request-shaping helpers, not assertion-specific setup, and other daemon run-control test files could reuse them.

## Decisions

- Move `mockWriteLoopInput`, `startRun`, `listRuns` into a new `v2/src/testing/` module; keep assertion-specific setup (fake executor, per-test state-store wiring) in `daemon-start-list.test.ts` — rules out moving test-scenario logic out of the file.
- Migrate only `daemon-start-list.test.ts` to import the shared helpers; rules out touching other daemon test files in this subspec.
- Keep tests wired through production `createRunControlHandlers`; rules out reintroducing inline handler doubles.
- Keep the existing `test.skipIf(!canUseUnixSockets())` socket-skip usage as-is; rules out a second socket probe.
- No production code changes.

## Acceptance criteria

- [ ] `mockWriteLoopInput`, `startRun`, and `listRuns` are defined in a module under `v2/src/testing/` and exported for reuse.
- [ ] `daemon-start-list.test.ts` imports these three helpers from `v2/src/testing/` instead of defining them locally, and still constructs handlers via production `createRunControlHandlers`.
- [ ] `daemon-start-list.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `v2/docs/test-writing.md` documents `v2/src/testing/` as the home for generic daemon run-control request helpers (`mockWriteLoopInput`, `startRun`, `listRuns`), distinguishing them from file-local scenario assertions.

## Documentation updates

- `v2/docs/test-writing.md`: add the daemon run-control helpers to the shared-fixtures guidance, alongside the existing `canUseUnixSockets` fixture description.
