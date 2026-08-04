Verifying key codebase claims before issuing the verdict.
## Verdict: required refinements

### 1. Fix subspec structure — mislabeled, duplicated, not independently implementable

Both subspecs target the same daemon seam (`RunOperatorError`, `mapFromLoopFinished`, shared test files) while `00-persistence` implies persistence work it does not perform. Problem statements, decision ledgers, and task checklists are duplicated; `00`’s checklist includes integration tests and docs that `01` owns in acceptance criteria; `00` has an empty `## Documentation updates` section.

**Required outcome:** Restructure so each index-linked subspec is atomic and independently testable per spec guidance. Either merge into one daemon subspec carrying all tasks and acceptance outcomes once, or split by verification layer (e.g. unit composition vs integration list/wait) with disjoint task lists, non-duplicated decision prose, correct naming, and documentation ownership assigned to exactly one subspec. Every original task and acceptance outcome from intent and both current subspecs must appear exactly once across the result.

---

### 2. Align intent acceptance criteria with the no-entry-row-projection decision

The intent decision ledger rules out widening workflow owner adoption to `completion_commit_failed`. Current code only adopts sibling terminal errors for `surviving_mutation_failed` and `mutation_repair_exhausted`; the hidden-shrink fixture asserts entry **status** rollup and shrink-row **error**, not `completionCommitError` on the entry row.

**Required outcome:** Reword the intent acceptance criterion so “workflow entry” reads as fixture topology (failed entry rollup + stopping shrink sibling), not a requirement that the entry row’s `list`/`wait` payload carries `error.completionCommitError`. The contract must state that list and wait on the **owning sibling run id** surface the terminal `loop_finished` message. If entry-row error adoption is desired, that is out of scope for this spec and needs a separate intent.

---

### 3. Carry prerequisite chain into subspec gates

Intent prerequisites assume durable storage of `completionCommitError` and that the execution loop writes it on every `completion_commit_failed` terminal append. Subspecs do not restate or gate on the upstream emit work; an implementer could satisfy tests via fixtures while production write paths still omit the field.

**Required outcome:** Each subspec (or a single merged subspec) must include a `## Prerequisites` section naming the emit/write-loop dependency, or an explicit operator gate (e.g. “emit spec merged”) so implementation does not land before production paths persist the field.

---

### 4. Add negative and coexistence acceptance coverage

The decision ledger requires omitting `completionCommitError` when the terminal row lacks it and keeping `publicationFailure` alongside it when both exist. Unit AC covers coexistence on the happy path; integration AC for the hidden-shrink fixture currently asserts `publicationFailure` only. No AC pins the omit-when-absent guard or cites existing preservation behavior for unrelated outcomes.

**Required outcome:**

- An acceptance criterion (unit or integration) proving `completionCommitError` is **absent** when the terminal `loop_finished` row has no such field — with a failing-test requirement against baseline.
- Integration acceptance must assert **both** `completionCommitError` and `publicationFailure` on the owning sibling for list and wait when both are present in the fixture.
- Optionally cite an existing test (e.g. landing vs completion distinction) as preservation that `iteration_commit_failed` composition stays unchanged — low cost, matches refactor-AC guidance.

---

### 5. Clarify message semantics in acceptance criteria

“Same underlying completion-commit message” is ambiguous about normalization vs byte-for-byte copy from the terminal event.

**Required outcome:** Acceptance criteria should state that `error.completionCommitError` is the terminal `loop_finished.completionCommitError` string projected without re-normalization — same pattern as existing `publicationFailure` projection.

---

### 6. Resolve documentation and CI acceptance ownership

Intent requires updates to `daemon-host.md` and `v1-behaviors.md`; typecheck and full v2 test scripts must pass. Currently docs live only under `01`; CI gates only under `00`.

**Required outcome:** After restructuring (refinement 1), documentation updates and the `bun run typecheck` / `test:v2` / `test:integration:v2` criterion must each appear exactly once in an appropriate subspec’s acceptance criteria or documentation section — not duplicated, not orphaned in an empty section.

---

### 7. Optional operator-facing doc note (recommended, not blocking)

Entry rows can show `status: failed` without inheriting sibling `completion_commit_failed` detail under current owner-adoption rules. This is intentional for this slice but may surprise operators once `completionCommitError` exists on sibling rows.

**Required outcome:** `daemon-host.md` updates should note that workflow entry rows do not inherit sibling `completion_commit_failed` operator error detail — co-located with the new field documentation.

---

### Rationale

The core design (optional `RunOperatorError.completionCommitError`, projected from terminal `loop_finished` for `completion_commit_failed` only, coexisting with `publicationFailure`, without new precedence paths) is sound and matches intent decisions. The refinements above address spec-guidance violations: non-atomic subspecs, ambiguous behavioral ACs that could be read as contradicting the decision ledger, missing failing-test coverage for negative guards, and invisible prerequisite ordering that allows green tests without production write-path completeness.