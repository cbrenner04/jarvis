Verifying key codebase claims so the verdict rests on the actual reconciliation and persistence behavior.
## Verdict: required refinements

### 1. Cover the motivating stale-timestamp scenario in acceptance criteria

The intent’s primary failure mode is a run with **completed prior attempts and no open `in-progress` attempt** when reconciliation settles it: attempt `completed_at` stays stale. Decisions already route this to `reconciled_at`, but acceptance criteria only pin zero-attempt rows (AC #2) and completed-plus-open-attempt rows (AC #3). The completed-only path is unverified.

**Required outcome:** Add an acceptance criterion that orphan settlement on a run with one or more completed attempts and no `in-progress` attempt sets non-null `reconciled_at`, leaves prior attempt `completed_at` values unchanged, and makes `reconciled_at` strictly later than the maximum prior attempt `completed_at`.

**Rationale:** Without this, the spec can pass while leaving the headline bug unguarded.

---

### 2. Verify `reconciledAt` read-path exposure

Decisions and tasks require `reconciledAt` on `Run` and mapping through `loadRun`/`listRuns`. Existing criteria only assert SQL-layer stamping; the regression test can pass without proving the read API.

**Required outcome:** Add an acceptance criterion that after `reconciled_at` settlement, `loadRun` and a `listRuns` entry both return non-null `reconciledAt`.

**Rationale:** For a persistence subspec, schema and type mapping are part of the contract; exposure is decided but currently untestable from the spec.

---

### 3. Collapse the non-atomic daemon subspec

`01-daemon` duplicates `00-persistence` in problem, decisions, tasks, and documentation. It assigns persistence work to the daemon surface, requires no daemon implementation (list `finishedAtMs` is deferred), and its only unique criterion is preservation of `daemon-reconciliation.test.ts`.

**Required outcome:** Remove `01-daemon` as a separate implementable subspec. Move its preservation criterion into `00-persistence` using the refactor pattern (`daemon-reconciliation.test.ts` stays green). Update `index.md` so the spec routes to a single persistence subspec that owns all work and outcomes.

**Rationale:** Spec guidance requires atomic, independently testable subspecs at one module boundary. A duplicate shell with no implementation unit violates that and creates maintenance drift.

---

### 4. Pin the review-debate acceptance case to a concrete stamping branch

The review-debate criterion says “same rules as a `killed` orphan” but does not bind fixture shape, so it can be satisfied without exercising a distinct branch.

**Required outcome:** Specify which stamping path the review-debate case uses (e.g., open attempt → attempt stamp with `interrupted` status, or completed-only → `reconciled_at`), aligned with the task checklist’s review-debate coverage.

**Rationale:** Symmetric wording without fixture binding is not independently verifiable.

---

### 5. Add idempotence acceptance coverage

Decisions require settlement idempotence (already-terminal rows are not re-stamped), but no criterion tests it.

**Required outcome:** Add an acceptance criterion that a second reconciliation sweep or a row already `killed`/`interrupted` receives no additional finish-time stamp.

**Rationale:** Idempotence is stated behavior on a shared settlement path; without an AC it can regress silently.

---

### 6. Strengthen documentation obligations for durable shape and consumers

Two design choices need explicit doc coverage beyond the current bullet list:

- **Non-boundary attempt stamp:** `completed_at` on an attempt that remains `in-progress` with null `outcome_kind` is intentional; docs must state that max-`completedAt` readers are the intended consumers for that path and that boundary semantics require `outcome_kind` or attempt status.
- **Dual-timestamp fallback rows:** When `reconciled_at` is set, prior attempt `completed_at` values may remain stale; docs must state that raw max-attempt readers must not treat attempt `completed_at` as authoritative when `reconciled_at` is set, and that list/TUI precedence is owned by `list-row-step-honesty`.

**Required outcome:** Expand the `state-store.md` documentation updates in `00-persistence` to require these points explicitly.

**Rationale:** Partial staged delivery (store now, list consumer later) is correct serial planning, but durable state is ambiguous without documented consumer rules.

---

### 7. Clarify guard-inversion acceptance wording

The guard-inversion criterion reads like an implement-time inversion step rather than test design.

**Required outcome:** Reword so the regression must fail if either stamping guard is removed, with the no-attempt case proving no fabricated attempt row.

**Rationale:** Aligns with spec guidance’s guard-inversion intent without ambiguous verification semantics.

---

### Not required (upheld as sufficient)

- Deferred `finishedAtMs` / daemon list wiring (`list-row-step-honesty` prerequisite).
- `commitGuardedKill` and spawn-boundary exclusion from this slice.
- Per-orphan-status stamping ACs beyond the shared settlement path.
- Injectable clock / millisecond-collision test seam (fixed early `completed_at` seeding in tests is sufficient guidance).
- Stale `intent.md` line-number anchors (cosmetic only).