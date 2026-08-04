Verifying key implementation claims against the spec before issuing the verdict.
## Verdict — refinements required

### 1. Resume publication append sites lack mutation-checkpoint coverage

Subspec 01 task 26 requires a `// @mutate` pin for all four resume-settlement append fields. Production binds `intentResumePublicationCommitError` and `reviewMutationPublicationCommitError` at the two publication-failure appends, but `workflow-runner.test.ts` pins only `settleIntentResumeFailure` and `settleReviewMutationResumeFailure`. A regression that drops `completionCommitError` on either resume publication path will not turn a mutation checkpoint red.

**Required:** Each resume publication `completion_commit_failed` append must have pinning-test coverage equivalent to the helper paths — a test that drives that path, asserts terminal `loop_finished.completionCommitError` matches the resume outcome’s `message`, and links a `// @mutate` directive on the publication-specific binding (`intentResumePublicationCommitError`, `reviewMutationPublicationCommitError`).

**Rationale:** Subspec 01 tasks and parent `intent.md` AC 4 require `@mutate` on every added or modified guard; checked subspec ACs alone understate this obligation.

---

### 2. Parent `intent.md` acceptance criteria are stale

`index.md` and all three subspecs are checked; `intent.md` remains open. Parent AC 4 (“`@mutate` … every added or modified guard”) is not satisfied while two resume publication bindings are unpinned. Parent AC 3 (dual `completionCommitError` + `publicationFailure`) is scoped to write-loop in subspec 02, not workflow-runner.

**Required:** Reconcile `intent.md` with completed subspec scope — tick criteria that subspecs proved, narrow or drop parent-level claims subspecs intentionally scoped away (dual-field on write-loop only), and leave open only what the actuator still owes (resume publication mutation checkpoints above).

**Rationale:** Unchecked parent ACs contradict a completed spec tree and mislead downstream review.

---

### 3. `workflow-runner.md` misstates resume caller semantics

The amended bullet says every `completion_commit_failed` append writes the same `completionCommitError` “that the workflow result returns.” Resume settlement returns `{ ok: false, message }`; there is no `completionCommitError` on those outcome types. Implementation correctly copies `message` into the log field.

**Required:** Amend `workflow-runner.md` so resume settlement is described as copying the caller-observable failure text (`completionCommitError` on workflow results, `message` on resume outcomes) onto the terminal `loop_finished` record — not as returning a symmetric `completionCommitError` field from resume APIs.

**Rationale:** Operator-facing docs must match observable API shapes; the current wording implies a field resume callers do not expose.

---

### Not required

- **Conditional spread vs narrowed `if` branches on resume publication appends:** Types are green; behavior matches subspec 01’s message semantics. Restructuring to match subspec 00’s branch shape is optional consistency, not a behavioral defect.
- **Dedicated write-loop no-agent test, markdown-only fence assertion, consolidating redundant write-loop `@mutate` comments:** Outside checked subspec ACs; optional hardening only.
- **Doc note on resume publication fallback (`failure.kind` vs `"completion commit failed"`):** Field presence claims in `v1-behaviors.md` / `v2-architecture.md` are accurate; cross-family fallback divergence is a precision nuance, not a blocking doc defect.