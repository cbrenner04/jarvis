## Verdict — required outcomes

Extraction and wiring meet spec scope; the gaps below are documentation accuracy and test pins for invariants the spec already claims. Address all five before this slice is complete.

### 1. Unknown-run test must pin the no-orphan-replay invariant

The spec requires that a `runId` with no `loadRun` row closes without `stream-data`, even when persisted log events exist for that id. The current unknown-run test uses an empty log file, so it only exercises immediate guard close — not “do not replay orphans.”

**Required:** A test where log events exist for a `runId` that has no durable store row must close without emitting `stream-data`.

### 2. `onClose` documentation must match guard vs follow behavior

The handler calls `onClose` synchronously on malformed/unknown-run guard paths and only uses `finally` after entering `follow`. The doc currently states `onClose` is always invoked in `finally`, which is false for guards.

**Required:** Documentation must distinguish guard-path `onClose` (once, before return) from follow-path `onClose` (in `finally` after `follow` completes or aborts).

### 3. Thrown-error documentation must reflect the real stream boundary

`@throws Never` overclaims. Guard branches are non-throwing; `JSON.parse`, `loadRun`, `follow`, and `onData` failures can propagate and are handled by the IPC server as error `stream-end`. The acceptance criterion explicitly requires honest thrown-error documentation on both exported symbols.

**Required:** Replace the blanket non-throwing claim with a boundary contract that states which paths are non-throwing and that dependency/parse failures propagate to the IPC layer.

### 4. Guard-path tests must prove `follow` is never invoked

Invalid/missing/unknown-run tests assert client-visible close-only behavior but do not verify `logReader.follow` is skipped. That leaves the core “`loadRun` before `follow`” invariant unproven on guard paths.

**Required:** Invalid-payload, missing-`runId`, and unknown-run tests must assert `follow` was not called.

### 5. `TailStreamHandlerDeps` documentation must satisfy the acceptance criterion

The deps type documents field purpose only. The AC requires both `createTailStreamHandler` and `TailStreamHandlerDeps` to document purpose, params, returns, thrown errors, and invariants.

**Required:** Bring `TailStreamHandlerDeps` inline docs to the same contract depth — including thrown-error posture (N/A or consumer obligations) and field-level invariants — so both exported symbols meet `v2/docs/documentation-standard.md` and the subspec doc AC.

---

### Not required for this slice

- Known run with durable row but zero log events (deferred; no AC).
- Bounding replay to exactly two frames (AC satisfied by seq-order assertion).
- Stricter abort timing parity with `ipc.test.ts` (AC pins signal abort at `stream-end`).
- String JSON `stream-open` payload test (spec deferral).
- `ipc.test.ts` migration or `test-writing.md` example (owned by follow-on intent).
- Pre-existing `onData`-throw / blocking-`follow` behavior (semantics unchanged).
