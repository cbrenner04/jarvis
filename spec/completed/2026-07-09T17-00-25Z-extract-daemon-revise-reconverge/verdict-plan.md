**Verdict**

1. **Upheld: circular-import risk from `checkWorktreeClaimed`/`OwnershipKey`.** `reviseAwaitingHuman` calls `checkWorktreeClaimed(_registry, key)` directly and constructs an `OwnershipKey` inline — neither is in the proposed `ReviseReconvergeDeps` (`store`, `registry`, `checkWorktreeDirty`, `spawnWriteLoop`). As drafted, `daemon-revise.ts` would need to import `checkWorktreeClaimed`/`OwnershipKey` from `daemon.ts` while `daemon.ts` imports the three extracted functions back — a circular import between the two files, which contradicts the spec's own framing that this follows the existing deps-object extraction pattern cleanly. The spec must resolve this explicitly, by one of:
   - adding `checkWorktreeClaimed` (and the `OwnershipKey` type) to `ReviseReconvergeDeps`, or
   - stating that `OwnershipKey` (type-only) and `checkWorktreeClaimed` (pure function) are safe to import back from `daemon.ts` into `daemon-revise.ts` without circularity concerns, and why (no shared mutable module state, no side effects at import time).

   Leaving this unstated risks the actuator either hitting a runtime/type circularity or silently improvising a resolution that diverges from the deps-object pattern the spec claims to enforce.

2. **Not upheld as a blocking issue: `registry`/`_registry` naming.** The task checklist already directs building the deps object from the existing `_registry` local per the `promoteQueuedRunImpl` precedent (`registry: _registry`), so this is adequately covered by cross-reference to existing code; no refinement required.

**Required outcome:** Revise the Decisions/Task Checklist to explicitly cover how `checkWorktreeClaimed` and `OwnershipKey` cross the `daemon.ts` ↔ `daemon-revise.ts` boundary, ruling out an unresolved circular-import gap before this reaches the actuator.