# Shrink daemon sandbox-unrunnable suite to one smoke test

## Problem

`v2/src/daemon/daemon.sandbox-unrunnable.test.ts` carries 7 real-process/real-socket
tests. Most re-prove behavior already covered by DI-based tests
(`daemon-lifecycle.test.ts`) or exercise pure in-memory logic
(`WorktreeOwnershipRegistry`) that doesn't need OS seams at all. Only the
detached-process wire check — spawn, serve health over a real socket, stop,
socket unbinds — needs a real process and a real socket.

## Decisions

- Keep exactly one test in the smoke file: start a detached daemon, verify health over the real socket, stop it, verify the socket is unbound — rules out re-proving DI-covered lifecycle behavior (`getDaemonStatus`, `DaemonAlreadyRunningError`, status RPC) at integration cost.
- Move `WorktreeOwnershipRegistry` claim/release/multi-key coverage into a new agent-runnable `v2/src/daemon/daemon-registry.test.ts` — rules out requiring OS seams for pure in-memory map logic.
- Keep the `.sandbox-unrunnable` infix and file location — rules out rename churn and preserves `test:integration:v2` collection.
- If the socket-unbound assertion races on direct-connect rejection, poll with a short bounded interval rather than a single fixed `setTimeout` — rules out broad wall-clock waits per the determinism smell checklist.

## Task Checklist

- [ ] Rewrite `v2/src/daemon/daemon.sandbox-unrunnable.test.ts` to contain one test: start detached daemon, connect and confirm `health` response, `stopDaemon`, then confirm a new connect attempt to the same socket path rejects.
- [ ] Remove the now-redundant tests from the smoke file: `getDaemonStatus reports running for live daemon`, `getDaemonStatus reports stopped after stopDaemon`, `status RPC on live daemon reports running state`, `second startDaemon fails with typed error while health succeeds`.
- [ ] Create `v2/src/daemon/daemon-registry.test.ts` (agent-runnable, no `.sandbox-unrunnable` infix) covering `WorktreeOwnershipRegistry`: claim, isClaimed, get, double-claim throws `DaemonDoubleClaimError`, release, release-on-unheld is a no-op, and independent keys coexist — moved verbatim from the smoke file.
- [ ] Confirm `daemon-lifecycle.test.ts` and `daemon-start-list.test.ts` still cover the removed status/already-running assertions through their existing DI/real-socket coverage; do not duplicate them.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon.sandbox-unrunnable.test.ts` contains exactly one `test`/`socketTest` case.
- [ ] `v2/src/daemon/daemon-registry.test.ts` exists, has no `.sandbox-unrunnable` infix, and passes under `bun run test:v2`.
- [ ] `bun run test:integration:v2` passes with the shrunk smoke file.
- [ ] `bun run test:v2` passes, including the new registry test.

## Documentation updates

- Update `v2/docs/test-writing.md`'s socket-fixtures section to cite the shrunk daemon smoke test as the minimum irreducible real-process example (start, serve health, stop, socket unbinds), alongside the existing `WorktreeOwnershipRegistry` note that pure in-memory logic belongs in an agent-runnable test instead.
