---
name: v2-socket-tests-skip-honestly
---

# v2 socket tests skip honestly

Make v2 socket-dependent tests report skipped when Unix sockets are unavailable.

## Prerequisites

- v2 testing utilities expose a shared Unix-socket availability probe.

## Decisions

- Use `test.skipIf(!canUseUnixSockets(), ...)` for touched v2 socket tests; rules out early returns that report pass without executing.
- Keep the migration v2-only; rules out changing v1/shared sandbox-unrunnable behavior in this work.

## Behavior

- v2 integration tests that require sockets skip through Bun's test API when sockets are unavailable.
- V2 agent-runnable socket tests touched by the change use the same skip semantics.
- No v2 socket test keeps a local `skipIfNoSockets` wrapper that returns early as a pass.

## Documentation updates

- Update `v2/docs/test-writing.md` to require `test.skipIf` for v2 socket-gated tests and forbid silent-return skips.
