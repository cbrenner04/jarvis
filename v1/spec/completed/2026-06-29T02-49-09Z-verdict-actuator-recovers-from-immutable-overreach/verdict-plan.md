## Verdict: Refine before merge

Scope and architecture are sound. Required refinements tighten contracts the implementer would otherwise guess wrong on.

### Required refinements

1. **Classifier inputs** — Decisions/task checklist must state recovery eligibility uses **snapshot diff on registered immutable-copy paths** (drift from pre-actuator bytes) **and** `validateReviewOutput` failure, not error-string parsing. `validateReviewOutput` is the gate and re-validation function only.

2. **Mixed-failure exclusion** — Keep explicit no-recovery when immutable drift coexists with any other validation failure (e.g. missing `index.md`). Classifier must require immutable-only drift.

3. **Boundary gate scope** — Remove "boundary violations" from the validation-failure exclusion bullet, or note boundary (`assertPlanWriteBoundary`) is a separate post-revalidation hard-fail in commit mode. Recovery addresses `validateReviewOutput` failure only.

4. **Revert mechanism** — Pin **write pre-actuator snapshot bytes** to disk for each affected path. Drop ambiguous `git checkout` — worktree may differ from HEAD.

5. **Invalid blocker composite** — Add decision and regression coverage: when `intent.md` changes include an invalid blocker composite (e.g. frontmatter edit plus `## Blocker`), **no recovery** — same hard-fail as today (`review.sandbox-unrunnable.test.ts` frontmatter+blocker case).

6. **Valid blocker path** — Clarify recovery never runs when `isValidIntentModification` would pass (valid blocker-only append). Actuator blocker stop/commit parity with reviewer `readBlocker` is **out of scope** unless explicitly added; avoid conflating reviewer and actuator blocker semantics.

7. **Fallout notice contract** — AC requires fallout when verdict explicitly targets `intent.md`; pin minimal v1 detection (literal or backtick-wrapped `intent.md`, case-sensitive) in decisions or task checklist, with unit test. General extraction stays deferred.

8. **Operator notice** — `plan-mode.md` doc task should pin notice shape (stderr prefix, per-path reverted lines, optional fallout line). Spec AC can stay behavioral.

9. **Runbook doc task** — Replace "remove manual `intent.md` revert" framing. Current transient-killed guidance only mentions `index.md` reconcile. **Add** that actuator-time immutable overreach is recovered automatically; do not instruct manual `intent.md` revert.

10. **Test coverage gaps** — Task checklist / AC should require:
    - `commit: true` recovery integration (revert, re-validate, commit proceeds)
    - `commit: false` recovery integration (snapshot write revert before phase success)
    - Invalid-blocker-plus-drift no-recovery regression
    - Fallout notice when verdict contains pinned `intent.md` reference

### Not required

- Patch shared-hook scaffolding — empty/minimal registry today, preservation AC citing `review.sandbox-unrunnable.test.ts`, no patch `validateReviewOutput` yet: sufficient for intent's forward-looking coverage.
- Boundary-fail-after-recovery belt-and-suspenders test — optional; boundary is out of recovery scope.
- Fundamental redesign or subspec split.
