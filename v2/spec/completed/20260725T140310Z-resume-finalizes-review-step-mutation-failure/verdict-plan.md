## Verdict: required refinements

### 1. Reconstruction and publication-tail entry (required)

The subspec must state **how** `jarvis run resume` on a `failed` review-behavior row with `loopOutcomeKind: "surviving_mutation_failed"` reaches mutation verification and finalization **without** `reconstructWriteResume` and **without** replaying the implement write step.

- Replace vague “persisted post-review checkpoint” language with an explicit **decision or task** that defines the admission predicate (e.g. failed + `surviving_mutation_failed` treated as “review agents done, tail only”) and the **execution entry** (daemon/workflow branch that drives the existing publication/finalization path, not write-loop landing retry).
- **Remove or correct** the analogy to “landing/publication resume on write rows.” The operator outcome is re-verification, ready gate, and draft→ready via the **workflow publication tail** (same family as post-review `publishWithReadyRepair`), not shrink/landing checkpoint resume on write rows.
- Add a **decision** that resume re-enters the tail with a **completion-bound** loop result suitable for that path (aligned with how the workflow attributes publication to the completion step), and that a generic `failed`-row / `committedResult` path must not be assumed to auto-replay publication the way a `complete` write-loop result does.

**Rationale:** Intent and first AC bind the outcome; without this, implementers can satisfy “no write step” in one place and still fail finalization or break row/`runId` ownership from the sibling `surviving-mutation-row-honest-on-any-step` spec.

---

### 2. Row identity and completion-step attribution (required)

Add a short **decision** that resume is invoked on the **durable review row** that owns `surviving_mutation_failed`, while publication/finalization work is attributed consistently with the workflow **completion step** (so `loop_finished` / terminal state on the resumed row id matches honest settlement).

**Rationale:** Prevents fixes that complete on the wrong row or respawn a write loop under the implement step.

---

### 3. Scope boundary for widened review resume (required)

Add one **decision** line: resume reconstruction for review-behavior steps applies **only** when terminal outcome is `surviving_mutation_failed` (plus existing `nextAction: "resume"` admission); other review failures (e.g. landing `invocation_failure`, timeouts) must **not** gain write-loop or publication-tail resume merely because review steps are mentioned in scope.

**Rationale:** Matches intent (“post-write verification failure”) and blocks scope creep when admission widens in the prerequisite.

---

### 4. Acceptance criteria tightening (required)

- **Guard inversion (AC3):** Require that inverting the review-step `surviving_mutation_failed` resume guard restores **`resume_unsupported`** **or** causes an **implement** `iteration_started` / agent invocation—not an unspecified “spawns a write loop.”
- **Write non-invocation (AC2):** **Choose one** primary test home (`daemon-resume.test.ts` vs `workflow-runner.test.ts`) for the end-to-end resume fixture that asserts **no** extra agent activity on the already-completed implement write step; drop “or the same daemon suite if…” so coverage cannot be RPC-only.
- **`review-debate`:** Decisions include durable `review-debate` last steps; either add a **new-behavior** resume-success AC (parallel to `implement-review`) **or** explicitly state that one workflow fixture exercises **both** step kinds on the same code path, with AC text that makes that binding.

**Rationale:** Spec guidance requires failing-test and guard-inversion ACs for behavior changes; `review-debate` in decisions without a positive AC is a coverage gap.

---

### 5. Publication-tail operator scope (recommended, treat as required if tasks stay broad)

One **decision** or task clause: “respawn publication/finalization” means existing `publishWithReadyRepair` (and ready finalizer) behavior—re-verification and ready/draft→ready as intent states—not a new operator workflow; commit/push/PR refresh follow **existing** finalizer/idempotency rules.

**Rationale:** Clarifies intent AC without mandating file-level implementation.

---

### 6. Documentation tasks (required nuance)

- **`daemon-host.md`:** Doc update must say review-step resume uses **completion-step / publication-tail** reconstruction, not empty review-snapshot fields (`stepRules`, `expectedArtifactPath`) as the write-resume contract.
- **Runbook:** Existing tasks (Gate trust, gotchas) remain; ensure they **replace** the misleading “resume owning `~shrink` only” story for review-owned `surviving_mutation_failed`, consistent with intent.

**Rationale:** `v1-behaviors.md` is already listed; daemon-host without snapshot vs completion-step wording risks wrong operator mental model.

---

### 7. Prerequisites housekeeping (required before merge)

Refresh **`intent.md` `## Prerequisites`**: do not state both prerequisites are “not yet on `main`” if merged specs on the branch already satisfy them. Keep **land order** as operator contract; prose should match observable repo state so implement runs are not blocked on stale text.

**Rationale:** Prerequisites are validation gates per spec guidance; stale blocker language misdirects operators.

---

### 8. Optional but valid if cheap

- **Negative ACs** (or citations to existing tests): `jarvis run resume` on **entry id** and on **completed `~shrink`** still refuse (`terminal_run` / wrong row), matching intent problem statement—only if not already pinned by name elsewhere.
- **Task ordering** in Tasks: state reconstruction/publication-tail branch **before** checkpoint-skip preservation, since skip behavior depends on entry path.

---

### Overall

**Approve direction; do not implement from this draft until refinements 1–4 and 7 are applied.** The intent is sound and a single subspec remains appropriate; the gap is spec prose that implies machinery (checkpoint, write-row publication resume) that does not apply to `failed` review rows until explicitly extended and tested.