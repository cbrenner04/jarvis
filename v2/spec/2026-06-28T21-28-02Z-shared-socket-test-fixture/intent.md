---
name: shared-socket-test-fixture
---

# Shared socket test fixture

Move the duplicated Unix-socket capability probe and `skipIfNoSockets` wrapper into `v2/src/testing/`, then migrate the socket-backed v2 tests to import it without changing assertions.

## Decisions

- One shared socket fixture under `v2/src/testing/`; rules out per-file probe blocks in `ipc.test.ts`, `daemon.sandbox-unrunnable.test.ts`, and `daemon-start-list.test.ts`.
- Deferred to first consumer: socket probe evaluation timing — pin when a caller needs it.
- Preserve existing skip semantics and messages where tests currently depend on them; rules out turning unavailable sockets into hard failures.
- Document shared fixture ownership in `v2/docs/test-writing.md`; rules out leaving the new testing surface discoverable only by import search.

## Prerequisites

- v2 test-writing conventions distinguish agent-runnable tests from sandbox-unrunnable tests.

## Documentation updates

- `v2/docs/test-writing.md` lists shared socket fixtures under `v2/src/testing/` and when tests should use them.
