**Verdict**

Required outcome: `resumePausedRun` in `v2/src/daemon/daemon.ts` must not let binding-resolution failures escape as unhandled exceptions.

- Widen the guard preceding binding resolution to also treat an empty `snapshotStep.agents` array as the "cannot resume" case (matching `not_implemented`), consistent with how `buildRevisionWriteLoopInput` treats a missing/empty `agents` list.
- Wrap the `resolveExecutableRole`/`resolveInvocationBindings` call in `resumePausedRun` in error handling so a thrown error (e.g., non-executable role) returns a controlled RPC error rather than crashing the handler — mirroring the try/catch pattern already established in `buildRevisionWriteLoopInput` for the same resolution call.
- Add or confirm test coverage in `daemon-resume.test.ts` for a paused workflow-step run whose snapshot has an empty `agents` array (and/or non-executable role), asserting a controlled error response instead of an unhandled throw.

Rationale: this is new code introduced by this spec's `resumePausedRun` function, not pre-existing behavior, so it's in scope. An unhandled exception inside an RPC handler is a correctness defect regardless of whether any AC explicitly names the empty-array case — the codebase's own sibling function establishes the expected defensive pattern, and this function should follow it for consistency and reliability of the daemon RPC surface.

The other reviewed concern (the `resumeHandler` fallback for non-paused resumable statuses spawning with empty bindings) is confirmed pre-existing and untouched by this spec's diff beyond a comment removal — no action required there.