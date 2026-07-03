---
name: daemon-run-control-fixtures
---

# Daemon run-control fixtures

Move generic daemon run-control test helpers such as `mockWriteLoopInput`, `startRun`, and `listRuns` into `v2/src/testing/`, then migrate `daemon-start-list.test.ts` to use them while still exercising real `createRunControlHandlers`.

## Decisions

- Share only generic run-control request helpers; rules out moving assertion-specific setup out of `daemon-start-list.test.ts`.
- Keep tests wired through production `createRunControlHandlers`; rules out reintroducing inline handler doubles.
- Depend on the shared socket skip fixture for socket availability handling; rules out a fourth socket probe in the migrated file.
- No production code changes; rules out changing daemon IPC behavior while moving test helpers.

## Prerequisites

- `daemon-start-list.test.ts` already exercises production `createRunControlHandlers` (shipped in `completed/2026-06-28T12-37-04Z-daemon-start-list-use-real-handlers-2`).
- Socket-backed v2 tests use a shared socket skip fixture.

## Documentation updates

- `v2/docs/test-writing.md` lists daemon run-control helpers under `v2/src/testing/` and distinguishes generic helpers from file-local scenario assertions.
