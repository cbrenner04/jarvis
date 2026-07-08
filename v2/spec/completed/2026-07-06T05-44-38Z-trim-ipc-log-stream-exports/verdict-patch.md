## Verdict — required outcomes

### 1. Restore file-local type aliases (not deletion/inlining)

`RequestFrame`, `StreamOpenFrame`, `IterationStartedEvent`, and `BoundaryCommittedEvent` must exist as **non-exported** `type` aliases in their respective files and remain referenced by `IpcFrame` and `LogEvent`. Wire shapes and exported unions stay unchanged.

**Why:** The spec tasks say remove `export`; decisions say these symbols **become file-local types** and forbid removing union members or changing wire shapes. Deleting the names and inlining shapes satisfies the “not exported” ACs vacuously but violates the binding method. `AppendWakeFactory` already follows the correct pattern.

---

### 2. Undo unauthorized doc-comment edits

Restore documentation removed outside the single authorized trim (`FrameDecoder.reset()` and its comment):

- `hasPartialFrame` doc in `codec.ts` (unrelated to `reset()` removal).
- Per-variant docs for the four restored aliases (collateral to outcome 1).
- `AppendWakeFactory` test-injection doc in `log-stream.ts`.

**Why:** Out of scope limits comment changes to `reset()`’s removal. No operator-facing behavior change does not license unrelated comment deletion.

---

### 3. Restore `defaultAppendWakeFactory` helper

The constructor default for wake injection must not inline `defaultAppendWakeFactory`’s logic unless the helper is removed with no structural refactor. Prefer restoring the named helper used before this branch.

**Why:** Decisions forbid refactors beyond de-export/delete on the listed symbols. Inlining is a small but real structural change with no spec authorization.

---

### 4. Complete seed-02 dedup at merge

Remove the six fulfilled symbols (`RequestFrame`, `StreamOpenFrame`, `FrameDecoder.reset()`, `IterationStartedEvent`, `BoundaryCommittedEvent`, `AppendWakeFactory`) from `v2/spec/seeds/02-v2-dead-weight-purge.md` when this work lands on `main`.

**Why:** The subspec records this as a post-merge obligation. Leaving them risks duplicate targeting on a future seed-02 run. Not grounds to reject `reset()` deletion or `AppendWakeFactory` de-export alone.

---

### Upheld as complete (no actuator change)

- `FrameDecoder.reset()` deletion matches spec; `ipc.test.ts` coverage is sufficient.
- `AppendWakeFactory` file-local de-export is correct; compile-time narrowing for zero-importer symbols is intentional.
- No durable `v2/docs/` updates required.
- Harness verification (`typecheck`, `test:v2`, `test:integration:v2`) remains the merge gate; not re-adjudicated here.
