Reviewing the implementation against the spec and durable docs before issuing the verdict.
## Verdict: required refinements

### 1. Restrict `completionCommitError` projection to `completion_commit_failed`

**Required outcome:** `mapFromLoopFinished` must project `error.completionCommitError` only when `loopOutcomeKind` is `completion_commit_failed`. `iteration_commit_failed` composition must remain as before this slice: `reason`, `nextAction`, `retryable`, and optional `publicationFailure` only — no `completionCommitError`.

**Rationale:** Subspec `00-unit-composition.md` decision ledger explicitly limits projection to `completion_commit_failed` and rules out widening other commit-failure kinds. The current merged `switch` branch applies the guard to both outcomes, contradicting that contract and the `LogLoopFinishedEvent` schema (where `completionCommitError` is typed only on `completion_commit_failed`). Emit paths never write the field for `iteration_commit_failed`; exposing it via composition would be an unintended behavioral expansion.

---

### 2. Pin `iteration_commit_failed` non-projection in unit tests

**Required outcome:** Unit coverage must prove that `composeRunOperatorError` does **not** set `error.completionCommitError` for `iteration_commit_failed`, including when a synthetic terminal event carries a `completionCommitError` string. The existing preservation regression (`"composeRunOperatorError maps ready gate, surviving mutation, and flip failures from loop_finished"`) must not be the sole guard — it only exercises the no-extra-fields path and would stay green while finding 1 remains.

**Rationale:** Subspec AC #4 (“`iteration_commit_failed` composition unchanged”) is meant to prevent scope creep, not merely confirm the happy path still passes. Without a negative assertion, the decision-ledger constraint is untested and the merged-case regression can recur silently.

---

### Not required for this actuator pass

- **Entry-row non-inheritance:** Documented in `daemon-host.md` and `v1-behaviors.md`; integration AC correctly scopes list/wait assertions to the owning `implement~shrink` run id per subspec `01`. A negative entry-row assertion would harden coverage but is outside written acceptance criteria.
- **Stale `intent.md` checkboxes:** Harness alignment; implemented behavior matches refined subspecs.
- **CLI tabular rendering, guard-style nuance, pipeline indirect coverage:** Out of scope or defensible per existing AC and deferred intents.

Fix findings 1 and 2 before merge. All other subspec acceptance criteria, docs updates, and integration assertions are otherwise satisfied.