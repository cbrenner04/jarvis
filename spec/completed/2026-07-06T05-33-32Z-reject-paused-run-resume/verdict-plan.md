## Verdict — required refinements

### 1. Pin the `list`/`wait` vs `resume` split
The spec must state that `composeRunOperatorError` is unchanged: paused rows on `list`/`wait` keep `resumable_pause` / `nextAction: "resume"`, while `resume` rejects with `not_implemented`. Without this, implementers may “fix” composition or reviewers will treat the mismatch as a defect. Required in decisions, at least one AC, and `v1-behaviors.md` / `daemon-host.md` updates.

### 2. Add `## Prerequisites` to the subspec
Carry intent prerequisites (`seed 01` landed; run-operator-error family exists). Spec guidance treats prerequisites as validation gates, not optional context.

### 3. Coordinate with seed 02 duplicate scope
Seed 02 still owns the same resume-placeholder bullet. The spec must state merge-order ownership: if seed 02 lands first, drop enum-extension tasks here; if this lands first, seed 02 drops its resume bullet without re-adding `not_implemented`. Prevents duplicate or conflicting implementation.

### 4. Close RPC `not_implemented` contract gaps
- Pin stable operator `message` (task checklist’s `message: …` is still open).
- Pin RPC `code === reason` (`"not_implemented"`).
- State `not_implemented` is `resume` admission vocabulary only — not a composed `list`/`wait` `error.reason` and not a row in the composition reason table unless composition changes.

### 5. Extend deferral for other placeholder-path statuses
Beyond `killed` / `budget-soft-stopped`, explicitly defer `queued` and non-live `in-progress` resume through the shared placeholder path. Same shared code path; omitting them leaves an undocumented hole.

### 6. Pin verification split
Name the in-process handler test file (e.g. `daemon-resume.test.ts`) and state it supplements — does not replace — the `daemon-start-list.test.ts` socket admission update. Aligns with `test-writing.md` (in-process for executor-not-invoked proof).

### 7. Add preservation AC for unchanged composition
Cite existing tests: `run-operator-error.test.ts` `resumable_pause` composition cases stay green. Spec guidance requires test citations for behavior-preservation ACs.

### 8. Align doc ACs with the split
`v1-behaviors.md` and `daemon-host.md` ACs must cover both surfaces: `resume` rejects `not_implemented` with durable status unchanged, and `list`/`wait` paused discovery semantics unchanged until binding reconstruction (seed 08). `daemon-host.md` should note `not_implemented` belongs on the `resume` RPC row, not the composition reason table.

---

**Rationale:** Core slice (reject before `spawnWriteLoop`, preserve `paused`, guard ordering, seed 08 boundary) is sound. Refinements address operator-facing inconsistency risk, seed-order duplication, incomplete RPC contract, and spec-guidance gaps (prerequisites, preservation AC citations, behavioral doc coverage) — not a rethink of approach.

**Optional (not blocking):** `write-behavior.md` operator-workflow row; explicit non-`paused` shared-path unchanged decision line; CLI/TUI generic error passthrough pin.
