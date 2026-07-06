---
name: drop-duplicate-ipc-tail-stream-tests
---

# Drop duplicate IPC tail-stream tests

Delete the `ipc.test.ts` tail-stream block (~lines 159–323 including helpers). It duplicates `daemon-tail-stream.test.ts` scenario-for-scenario; the daemon test file is the superset owner. PR body lists each dropped test with the surviving test that owns its behavior.

## Decisions

- Remove `ipc.test.ts` tail-stream block only — rules out deleting `daemon-tail-stream.test.ts` or transport-level IPC coverage.
- `daemon-tail-stream.test.ts` owns tail-stream handler behavior — rules out re-homing scenarios to a new file.
- PR body maps every dropped registration to its surviving owner — rules out silent test-count shrink.

## Prerequisites

- v2 lean documentation-standard and in-process daemon-test defaults are landed (seed 01)
- `daemon-tail-stream.test.ts` covers tail-stream IPC handler behavior as superset of the `ipc.test.ts` block

## Documentation updates

- None — test dedup only; `test-writing.md` already names in-process handler tests as default

## Verification

- `bun run typecheck`, `test:v2`, `test:integration:v2`
- PR body lists dropped tests with surviving owners (baseline: 481 registrations / 544 run cases)
