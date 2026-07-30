Reviewing implementation and docs against the spec to issue a verdict.
## Verdict: required outcomes before merge

### 1. Gate-only failure logging must stay truthful

On gate-only exhausted-red resume, a `ready_gate_failed` terminal must not always record `readyGateFailureOrigin: repair_budget_exhausted` and `retainedFinalizationCheckpoint: true`.

**Required:**
- Timeout failures keep `readyGateFailureOrigin: timeout` and are not re-admitted on the exhausted-red gate-only path.
- `repair_budget_exhausted` is recorded only when the failure is a non-timeout red gate after repair-budget exhaustion (including repeated gate-only reds).
- `retainedFinalizationCheckpoint` reflects whether draft-PR evidence (`prNumber` / `prUrl`) was actually present on the failure outcome — not forced true when evidence is missing.

**Why:** The subspec explicitly excludes timeout from gate-only resume and ties admission to retained checkpoint evidence. The unconditional override in `runReviewMutationCommitAndPublish` breaks both rules and can mis-route operators into repeated gate-only resume for deadline kills.

---

### 2. Ineligible `ready_gate_failed` rows must not fall through to write-loop resume

Rows that compose coarse `error.reason: ready_gate_failed"` / `nextAction: "resume"` but fail exhausted-red gate-only eligibility (missing checkpoint, wrong origin, mismatched lineage, etc.) and are not admitted on another finalization-tail path must be **refused at resume**, not reconstructed into a write-loop spawn.

**Required:**
- `jarvis run resume` returns `resume_unsupported` (or equivalent hard refusal) for at least the spec-named refusal cases — especially missing-checkpoint and timeout — rather than silently entering `reconstructWriteResume`.
- Daemon-level regression coverage for those refusals, not only unit tests on `resolveWriteExhaustedRedResumeContext`.

**Why:** Acceptance criteria require the eligibility matrix to **refuse** named ineligible origins. Coarse operator error is intentionally origin-agnostic; admission predicates must enforce the boundary at the daemon, matching how out-of-scope and review-mutation tails are already routed.

---

### 3. Fix `write-behavior.md` finalization order

The new exhausted-red paragraph must match canonical finalization order elsewhere in the same doc and in code: **ready gate → integration (when required) → mutation verification → runtime smoke → draft-to-ready flip** — not mutation before gate.

**Why:** Spec documentation updates require accurate checkpoint/tail semantics; the current paragraph contradicts § Ready finalization and `createReadyFinalizer`.

---

### 4. Update `daemon-host.md` for gate-only vs write-loop resume

Per `v2/docs/documentation-standard.md`, operator-visible resume routing belongs in durable docs. The `resume` IPC contract row must distinguish gate-only exhausted-red finalization-tail resume from write-loop reconstruction for other `ready_gate_failed` origins.

**Why:** Resume admission semantics changed; runbook/write-behavior were updated but the IPC contract table was not.

---

### 5. Strengthen green-path and refusal test coverage to match ticked acceptance criteria

**Green-path regression** (`exhausted-red implement completion: list, wait, and resume agree…`) must assert what the AC already claims:
- Finalization tail runs in order (ready gate, then mutation verification, then runtime smoke).
- Exactly one draft-to-ready flip on success.
- Checkpoint reuse: single commit/push under original attribution, existing draft PR refreshed, no duplicate PR.

**Repeated-red regression** must assert no ready flip on red gate-only resume (not only stable `ready_gate_repair` count).

**Eligibility matrix** must add the spec-named **unrelated-finalization** case (`ready_gate_failed` with lineage/checkpoint but no `readyGateFailureOrigin`).

**Why:** Core behavior may be correct via shared finalization tail, but ticked AC promises these observable outcomes; current tests under-assert them.

---

### 6. Not required for merge (document as follow-up)

- **Workflow entry / `~shrink` row identity:** Real gap for multi-step workflows; not exercised by this spec’s implement-only daemon tests. Defer to a linked follow-up — not a blocker for the standalone implement path.
- **Gate-only resume → `surviving_mutation_failed` handoff:** Undefined in docs; low frequency. A brief operator-runbook or write-behavior note is sufficient; not merge-blocking unless trivial to add.
- **Invert-guard AC wording:** Production guards need not expose invert hooks; behavioral tests suffice. No code change required — optional AC wording trim only.
- **`run-operator-error.test.ts` unchanged:** Defensible; coarse projection stays origin-agnostic by design.

---

### Merge posture

Approve the exhausted-red implement path **after** outcomes 1–5. Outcome 1 is a correctness bug; outcome 2 is a spec-boundary bug; outcomes 3–4 are required doc alignment; outcome 5 closes the gap between ticked AC and exercised assertions.