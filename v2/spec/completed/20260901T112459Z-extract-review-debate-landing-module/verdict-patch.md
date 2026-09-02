## Verdict — required outcomes

### 1. Subspec 01: restore the six-case move discipline

`workflow-runner-debate-landing.test.ts` must contain exactly the six cases named in subspec 01, moved from `workflow-runner-debate.test.ts`, with titles, assertions, fixtures, and `// @mutate` directives preserved byte-for-word.

Two moved cases currently violate this:

- `settles a debate-last intent workflow's landing failure the same as light review, with a trace` — extra `terminalCause`/`terminalFailureDetail` assertions, negative `loop_finished` check, and a new `@mutate` must be removed.
- `re-dispatching after a debate-role failure replays the full debate, not actuator-only` — `debateProgress` assertions and added `@mutate` must be reverted; the original `expect(role).not.toBe("actuator")` must be restored.

### 2. Subspec 01: remove unauthorized test additions

Tests in `workflow-runner-debate-landing.test.ts` that are not among the six named moves must not remain there under the current spec. That includes:

- The relocated `post-commit review retryability settle admits non-exhausted timeout and stall` case (not on the six-case list) — return it to `workflow-runner-debate.test.ts` or drop it from the landing file.
- All net-new cases (checkpoint reuse, md-lint `finishReviewDebateLanding` cases, delayed attribution, `discardEphemeralReviewVerdictDrift`, `revalidateStagedPlanContract` unit tests, strengthened reprompt case, etc.) — remove unless subspec 01 is formally expanded.

Rationale: subspec 01 explicitly rules out relocating unrelated cases and rules out weakening coverage while thinning the source file; it does not authorize co-location-driven test expansion.

### 3. Remove duplicate checkpoint coverage

`reuses a completed debate landing checkpoint on retry but not on a fresh dispatch` must not remain in `workflow-runner-debate-landing.test.ts` — equivalent coverage already exists in `workflow-runner-plan.test.ts`. Retargeting `@mutate` to the new module does not justify duplication.

### 4. Structure guard: pin `buildStandardReviewLandingActuatorContext`

Subspec 00 requires `buildStandardReviewLandingActuatorContext` to live in the landing module and rules out duplicating it in `workflow-runner.ts`. The structure guard must fail if that function is re-defined in `workflow-runner.ts`. Today only eight debate-local privates are pinned; the standard builder is a documented extraction boundary and is unguarded.

`settleReviewedStagedMarkdownLintFailure` is already covered by `execution-terminal-settlement-guard.test.ts`; no additional pin required for that symbol.

### 5. Trim exports widened only for unauthorized unit tests

If net-new direct unit tests are removed, `discardEphemeralReviewVerdictDrift` and `revalidateStagedPlanContract` must not remain exported solely to support those tests. Keep exports required by subspec 00 (`runReviewDebateStep`, `landReviewedOutputOrFail`, `finishReviewedLanding`, `settleReviewedStagedMarkdownLintFailure`) and the existing `isPostCommitReviewRetryableFailureKind` re-export.

### 6. Align `intent.md` with completed subspecs

Top-level `intent.md` acceptance criteria are stale (unchecked boxes, four-symbol structure guard vs eight in subspec 00, `test:integration:v2` not reflected in subspec checklists). Update it to match the completed subspec acceptance criteria before merge.

---

## Not required (upheld as acceptable)

- `completionBoundarySettlementFields` and `lastMutatingReviewPass` duplication — acceptable extraction cost given the no-circular-import / no-new-shared-module constraint.
- `ReviewDebateLandingDeps` naming, `LandReviewedPublicationOutput` dep typing, `ReviewStepOutcome` export, `@mutate-equivalent` in production, import-block ordering — intentional or cosmetic; no change required.
- Subspec 00 production extraction, `REVIEW_DEBATE_LANDING_DEPS` injection, settlement-guard path updates, and module-map doc — sound; preserve as-is.