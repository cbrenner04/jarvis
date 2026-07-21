# Verdict: Required Refinements

The spec targets the right defect and layer (daemon entry `wait`/`list` outcome projection, reusing existing exit/payload helpers). Before merge, it must close the gaps below so implementers have a bounded, testable contract aligned with intent and spec guidance.

---

## 1. Outcome-owner selection must be an explicit decision, not a work-item promise

The subspec names a helper but does not define when it runs or how it picks among siblings. That leaves authored-step failures, publication-failure variants, and `ready_flip_failed` ambiguous.

**Required outcome:** Add Decisions that state:
- Re-sourcing applies only to workflow **entry** rows when rollup is terminal and the entry row’s terminal record would disagree with rollup on outcome-carrying fields.
- Selection follows the same “rollup stopping step” logic already used for status rollup (including hidden `~shrink` when it drives rollup `failed`).
- Whether later authored durable step failures are in scope now, or explicitly deferred with rationale.
- `ready_flip_failed` is **out of scope** for this intent (rollup stays `completed`; entry projecting `complete` / exit 0 is correct).

**Rationale:** Without tie-break rules the work item is not independently implementable; the adversary’s strongest structural gap is real.

---

## 2. Helper contract must cover paired `(Run, record)` semantics

`wait`/`list` build results from both the durable run row and the terminal `loop_finished` record. Re-sourcing only the record while keeping the entry `Run` affects `error`, `resumeContext`, and `resumable` differently.

**Required outcome:** Decisions must state, for entry `wait` and entry `list`:
- Which outcome-carrying fields are taken from the owner (at minimum `loopOutcomeKind`, `error`, `resumable`, `iterationsConsumed`).
- Whether `composeRunOperatorError` and `resumeContextForRun` use the entry row, the owner row, or a defined combination.
- That `wait` and `list` share one selection path (no divergent projection).

**Rationale:** Prevents a fix that corrects `loopOutcomeKind` but leaves inconsistent error/resume fields or list/wait drift.

---

## 3. `resumable: true` on the entry id must not create an operator trap

If entry `wait` projects the shrink owner’s `survable_mutation_failed` and `resumable: true`, but `resume` on the printed entry run id still reads the entry log and rejects resume, operators get a contradictory signal.

**Required outcome:** Choose and document one bounded behavior:
- **Out-of-scope resume routing** with operator-runbook text that recovery uses the owning shrink row from `jarvis run list` (prerequisite already establishes shrink-row resume), **or**
- Project `resumable` only when the entry row itself is resume-eligible, **or**
- Include the outcome-owning `runId` in the wait/list payload (only if intentionally in scope).

Silence is not acceptable given the proposed AC requiring entry `wait` → `resumable: true`.

**Rationale:** Intent is reporting, but projected `resumable` is an operator-facing contract; honesty must match recoverability or be explicitly redirected.

---

## 4. Failing-test acceptance criteria must anchor on daemon integration, not mocks

Per spec guidance, runtime-behavior subspecs need at least one AC naming a test that **fails against pre-fix code**. The proposed `workflow.test.ts` AC mocks daemon `wait` and would pass pre-fix if the CLI only forwards wait results. The `workflow-runner.test.ts` AC asserts runner/workflow result without exercising entry `wait` projection and is similarly weak as a failing-test anchor.

**Required outcome:**
- **One authoritative daemon regression** (in `daemon-wait-run-completion.test.ts` or equivalent) that drives implement `completed` then hidden shrink `surviving_mutation_failed`, asserts entry **`wait` and entry `list`** report `runStatus: "failed"`, `loopOutcomeKind: "surviving_mutation_failed"`, mutation detail, and the chosen `resumable`/recovery semantics—and fails against pre-fix code.
- **Rework or remove** the CLI and workflow-runner ACs as failing-test anchors: drop them, reframe CLI as preservation citing an existing test, or require in-process daemon fixture (heavier—only if kept as contract pin).
- Success-path AC already covers entry `wait`/`list`; **failure path must match** with entry `list` assertions for `error.reason`, mutation detail, and `nextAction: "resume"` (or equivalent), not only entry `status: "failed"`.

**Rationale:** Spec guidance requires a real pre-fix failure surface; triple mock/indirect coverage adds review cost without guarding the bug.

---

## 5. Reconcile intent breadth with subspec failure taxonomy

Intent requires the command not emit an earlier constituent’s `complete` when the workflow ultimately fails. Subspec ACs pin only `surviving_mutation_failed`.

**Required outcome:** Either:
- Generalize the selection decision (and optionally ACs) to cover the same bug class for other publication failures on hidden finalization (`completion_commit_failed`, `ready_gate_failed`), **or**
- Explicitly state that only `surviving_mutation_failed` is in scope now and that sibling failure kinds are follow-up, with intent ACs reflected accordingly.

**Rationale:** Avoids intent/subspec mismatch and scope creep during implementation.

---

## 6. Prerequisites and documentation gaps

**Required outcome:**
- Repeat the prerequisite in the subspec: surviving-mutation failure must already settle on the owning shrink row as failed, resumable, and operator-visible with mutation detail (dependency on the completed prerequisite spec).
- Add `v2/docs/daemon-host.md` to Documentation updates (entry `wait`/`list` RPC semantics change).
- Cross-reference the completed rollup spec (`01-daemon-wait-list-rollup`) as completing deferred entry-row projection for hidden finalization rows—not contradicting it.
- Add one decision line on `iterationsConsumed`: sourced from the outcome owner at the publication boundary when re-sourcing, not implement-only counts on the entry log.

**Rationale:** Subspec-only implementers need the dependency; RPC and operator docs must stay in sync; prior rollup contract explicitly assigned stopping-step records to supply `loopOutcomeKind` but entry projection was left incomplete.

---

## 7. Subspec sizing — no split required

A single subspec remains appropriate: one seam (daemon entry projection + regressions + docs). Refinement is contract tightening and AC realignment, not a structural split.

---

## Summary

| Area | Verdict |
|------|---------|
| Bug diagnosis & fix layer | **Sound** — proceed |
| Owner-selection algorithm | **Must refine** — explicit rollup-aligned rules + scope bounds |
| Run/record helper contract | **Must refine** |
| `resumable` vs entry-id resume | **Must refine** — bound or redirect operators |
| Failing-test ACs | **Must refine** — daemon wait+list anchor; demote/drop weak CLI/runner ACs |
| Entry `list` failure coverage | **Must add** to match wait |
| Failure taxonomy vs intent | **Must reconcile** |
| Prerequisites, `daemon-host.md`, rollup cross-ref, `iterationsConsumed` | **Must add** |
| Subspec split | **Not required** |
