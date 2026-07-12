# 01 - Prove list and tail answer while the gate is held

Prove the invariant the previous subspec makes possible: with the ready gate pending, the daemon still serves unrelated IPC. Sibling proofs exist for Git admission, run Git, and completion publication — this one covers finalization and adds `tail`, which no existing responsiveness test covers.

## Decisions

- Bound is ordering, not wall clock: `list` and `tail` must resolve *while the injected gate seam is still pending* and *before* it is released; rules out a flaky millisecond threshold.
- Cover both `list` and `tail` over a live `startIpcServer` with connected Unix-socket clients; rules out asserting only the run-control handler in-process.
- Hold the gate by injecting a pending async `runReadyGate` seam into the finalizer, not by stubbing `readyFinalizer` wholesale; rules out a test that would still pass if the real finalizer went back to `execFileSync`.
- Follow the existing sandbox-unrunnable convention (`canUseUnixSockets()` skip guard); rules out a test that fails in the sandboxed agent environment.

## Acceptance criteria

- [ ] A new `v2/src/daemon/daemon-ipc-responsiveness-during-ready-gate.sandbox-unrunnable.test.ts` starts an IPC server, drives a write loop to completion with the ready-gate seam held pending, and proves `list` resolves before the seam is released.
- [ ] The same test proves `tail` for a live run resolves before the seam is released.
- [ ] Releasing the held seam lets finalization complete and the run reach its terminal state.

## Documentation updates

- `v2/docs/daemon-host.md`: name finalization (ready gate + draft-to-ready flip) among the daemon-hosted work that must not block IPC.
