Validating the advocate's critical admission-gap claim against the implementation before issuing the verdict.
## Verdict: required outcomes

### 1. Lint-exhaustion rows must be resumable on every documented recovery path

Review-path staged-Markdown lint budget exhaustion (and the resumable `landing_failed` settlement when the actuator cannot be reprompted) persists `outcomeKind: "landing_failed"` on the attempt and advertises `nextAction: "resume"` via `loop_finished` / operator error. Admission for review recovery still requires `invocation_failure` with `failureKind: "landing"` in `resolveIntentFinalizationResumeContext` and `findReviewLandingCheckpoint`.

**Required:** After lint-reprompt exhaustion with preserved stage bytes, an operator who hand-fixes staged Markdown can complete recovery without re-running critic/adjudicator/debate — intent via `jarvis run resume` → populated-stage finalization replay, plan via checkpoint re-entry (`finishReviewedLanding`). List/wait `nextAction: "resume"` must match what resume and checkpoint dispatch actually admit.

**Rationale:** Subspec `00` exhaustion AC, subspec `01` resume AC, and subspec `02` docs (`workflow-runner.md`, `operator-runbook.md`, `v1-behaviors.md`) all promise this flow. The promotion block is fixed; the documented operator recovery is not.

---

### 2. Prove lint-shaped settlement with end-to-end admission tests

Existing resume and daemon tests seed the legacy `invocation_failure` + `failureKind: "landing"` shape (`failReviewRunAtLanding`), not rows whose last attempt is `landing_failed` from review-path lint exhaustion.

**Required:** Tests that drive review to lint-exhausted `landing_failed` (or equivalent persisted shape), then assert admission succeeds and completion proceeds after fixing staged Markdown — at minimum one workflow-runner test for intent populated-stage resume and one covering plan checkpoint re-entry. Extend daemon resume coverage if that is where admission is gated.

**Rationale:** Without these tests, the admission gap can regress while unit tests on `resumePopulatedIntentPublication` (called directly with artificially seeded rows) stay green.

---

### 3. Checkpoint re-entry reprompt behavior must be exercised

`finishReviewedLanding` routes through `landReviewedOutputOrFail`, inheriting reprompt semantics, but the checkpoint test uses `stagedMarkdownLintMaxReprompts: 0` and only asserts terminal `landing_failed` with no extra role calls.

**Required:** A checkpoint re-entry test with lint-reprompt budget ≥ 1 that asserts, on violation: `staged_markdown_lint_reprompt` with rule id and file path, injected `write.staged-markdown-lint-reprompt` on the next actuator invocation, actuator retry without re-running debate roles, and no durable promotion while the violation remains.

**Rationale:** Subspec `01` decision ledger requires first-pass reprompt/exhaustion parity with the primary path; only exhaustion is covered today.

---

### 4. Mutation checkpoint must pin checkpoint-path lint protection

Subspec `01` AC calls for a `@mutate` that removes the `finishReviewedLanding` lint guard. Implementation delegates to `landReviewedOutputOrFail`; the current mutation stubs `landing_failed` outcome handling instead of disabling lint classification.

**Required:** The mutation must turn the checkpoint re-entry test RED via a failed behavioral assertion (not compile error) when checkpoint-path lint protection is removed. Prefer mutating the shared classifier in `reviewed-staged-markdown-lint.ts` (subspec `00` defense-in-depth pattern) if that is the actual guard on this path; the pin must not be maskable by unrelated outcome-handling stubs.

**Rationale:** Hollow mutation pins let checkpoint bypass regress without reddening the suite; subspec `00` explicitly rejected per-path guards for this reason.

---

### 5. Align checkpoint reprompt telemetry with the primary path (if reprompt test exposes a gap)

Checkpoint actuator context is built with empty hooks (`signal`, `idleOutputMs`, `onActuatorStart` omitted) while the primary path passes them.

**Required:** If the new checkpoint reprompt test reveals missing cancellation/idle telemetry on checkpoint actuator invocations, align hook forwarding with the primary landing path.

**Rationale:** Checkpoint reprompt is new actuator re-invocation surface; parity avoids silent behavioral drift.

---

### Not required in this pass

- Dedicated intent-primary `executeWorkflow` lint violation test (shared seam already covered on plan debate primary path plus intent resume replay gate).
- `invocation_error` review-path test coverage (documented fail-closed semantics; follow-on hardening).
- Lint-specific `composeRunOperatorError` copy (operator-runbook already documents hand-edit guidance; secondary to admission).
- `index.md` subspec `00` checkbox (harness bookkeeping; implementation and subspec `00` AC are present on branch).