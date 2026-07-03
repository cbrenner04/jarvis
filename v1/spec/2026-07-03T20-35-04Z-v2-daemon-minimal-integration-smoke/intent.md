---
name: v2-daemon-minimal-integration-smoke
---

# v2 daemon minimal integration smoke

Shrink the v2 daemon sandbox-unrunnable suite to the one detached-process wire check.

## Prerequisites

- `daemon-lifecycle.test.ts` covers daemon status and already-running behavior through injected probers.
- `daemon-start-list.test.ts` exercises real run-control handlers over real sockets.
- v2 testing utilities expose a shared Unix-socket availability probe.

## Decisions

- Keep one daemon `.sandbox-unrunnable` test that starts a detached daemon, verifies health over the real socket, stops it, and verifies the socket is unbound; rules out re-proving DI-covered lifecycle behavior at integration cost.
- Move `WorktreeOwnershipRegistry` claim/release coverage to an agent-runnable daemon registry test; rules out requiring OS seams for pure in-memory logic.
- Keep the `.sandbox-unrunnable` infix on the daemon smoke file; rules out rename churn and preserves integration collection.
- Use one short poll for the socket-unbound check only if direct connect rejection races; rules out broad wall-clock waits.

## Behavior

- `v2/src/daemon.sandbox-unrunnable.test.ts` contains exactly one detached-process smoke test.
- Removed daemon integration assertions remain covered by agent-runnable or existing socket-handler tests.
- Worktree ownership registry behavior is covered outside the sandbox-unrunnable suite.

## Documentation updates

- Update `v2/docs/test-writing.md` with the daemon smoke as the minimum irreducible real-process example.
