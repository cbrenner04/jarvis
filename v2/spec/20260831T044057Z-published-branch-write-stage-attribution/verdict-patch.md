Verifying the advocate's key findings against the code and docs before issuing the verdict.
## Verdict — required outcomes

1. **Apply write-stage authorship on every reviewed-last publication commit path.** The happy-path `executeWorkflow` publication tail now swaps to the durable write-stage agent when it differs from the review boundary agent, but other publication entry points still stamp review identity (`commitRecoveredPlanLanding`, populated-intent resume via `resolveReviewRowHead` → `runIntentResumeCommitAndPublish`). Updated docs (`workflow-runner.md`, `worktrees-and-commits.md`, `v1-behaviors.md`) describe corrected attribution on the single CAS-replaced published commit without limiting it to the primary tail. When write and review agents differ, every path that commits/pushes the surviving published commit must credit the write-stage agent in `Jarvis-Agent` (and therefore in the PR footer), while `Jarvis-Step` and review-classified subject prefixes remain terminal-boundary truthful.

2. **Make the completion-commit regression actually guard the stated scenario.** The acceptance criterion requires a test that simulates terminal review CAS-replace when write and review agents differ. The current test passes the write agent on both committer calls, so the negative assertion against a review agent is vacuous and would stay green even if callers never applied the authorship rule. The test must pass a distinct review-boundary agent on the terminal review-classified commit and assert the surviving message credits the write-stage agent. That regression must fail on pre-fix behavior and pass with the landed fix.

## Rationale

The spec’s minimum attribution contract applies to the surviving single published commit and its footer, not only the primary publication tail. Resume and plan recovery are part of the same publication contract documented in this change; leaving them on review-only authorship contradicts the updated operator docs and reproduces the original mis-credit on those paths.

The completion-commit regression is listed as an explicit acceptance criterion and is meant to pin the CAS-replace authorship behavior. A test that never supplies a differing review agent does not validate that contract and does not protect against regressions where only the main tail is fixed.

## Not required for this actuator pass

- Secondary review-agent trailers (write-only credit satisfies the minimum contract).
- Broader shape coverage beyond stated acceptance tests (e.g. `review-debate` harness, full implement landing).
- `intent.md` checkbox alignment, review-test comment/name nits, or ownership-bullet doc editorial cleanup — housekeeping only, not functional gaps.