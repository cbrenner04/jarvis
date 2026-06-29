# Immutable-copy overreach recovery

## Problem

Plan review actuator runs after the adjudicator, then `validateReviewOutput` gates commit (`v1/src/modes/plan/review.ts`). When the actuator applies valid spec/verdict edits but also dirties an immutable copied input (today: `intent.md`), validation fails and the pass is discarded — including allowed subspec edits and a written `verdict-plan.md`.

## Decisions

- Recovery eligibility: registered immutable-copy paths drifted from pre-actuator snapshot bytes **and** `validateReviewOutput` failed; classifier uses snapshot diff, not validation error-string parsing — rules out inferring drift from error text alone.
- `validateReviewOutput` is the gate and re-validation function only; `assertPlanWriteBoundary` (commit mode, post-revalidation) remains a separate hard-fail outside recovery — rules out folding boundary checks into the recovery classifier.
- Recover only when snapshot diff shows immutable-copy-only drift with no other `validateReviewOutput` failure (e.g. missing `index.md` alongside drift → no recovery) — rules out blanket validation bypass.
- Immutable-copy registry for plan review actuator: `intent.md` (byte-for-byte ready-intent copy) — rules out treating numbered subspecs or `verdict-plan.md` as immutable copies in this slice.
- Revert each affected immutable path by writing pre-actuator snapshot bytes to disk; no `git checkout`, no second actuator invocation — rules out trusting prompt adherence or HEAD-based restore when worktree differs.
- After revert, re-run `validateReviewOutput`; proceed to commit/push (or no-commit phase success) only when re-validation passes — rules out committing with a still-invalid tree.
- No recovery when `isValidIntentModification` would pass (valid blocker-only append on `intent.md`); actuator blocker stop/commit parity with reviewer `readBlocker` is out of scope — rules out recovery masking genuine blocker handling or conflating reviewer/actuator blocker semantics.
- No recovery when `intent.md` drift includes an invalid blocker composite (e.g. frontmatter edit plus `## Blocker`) — rules out recovering past `review.sandbox-unrunnable.test.ts` frontmatter+blocker hard-fail.
- Emit stderr notice: fixed prefix, one line per reverted path; when verdict text contains literal or backtick-wrapped `intent.md` (case-sensitive), append one fallout line that those verdict requirements were not applied — rules out silent loss of review intent.
- Deferred to first consumer: general verdict-to-path fallout extraction beyond pinned `intent.md` reference — pin when a caller needs it.
- Implement recovery in a shared review-layer helper; plan review actuator is the first consumer; patch review actuator registers immutable copies through the same hook at the post-success pre-commit boundary — rules out plan-only inline revert disconnected from patch actuation.
- Patch review's existing unconditional completed-spec revert after actuator success stays; this slice does not replace it — rules out refactoring patch spec revert into recovery or adding patch post-validation solely to exercise recovery.
- `commit: false` / external-spec plan review uses the same recovery and notice semantics before returning phase success — rules out commit-mode-only guard.

## Task checklist

- Add a shared helper (under `v1/src/modes/review/` or adjacent shared review code) that: accepts pre-actuator snapshots for registered immutable-copy paths, current on-disk bytes, a `validateReviewOutput` result, and a snapshot-write callback; classifies immutable-copy-only drift (snapshot diff, not error-string parsing); on eligible failure writes pre-actuator bytes per affected path, re-runs `validateReviewOutput`, returns recovered vs hard-fail.
- Wire the helper into the plan review actuator path in `v1/src/modes/plan/review.ts` after `runVerdictActuator` and before commit/skip-commit return; `assertPlanWriteBoundary` stays after successful re-validation on the commit path.
- Register `intent.md` for plan review actuator via the helper; pass `intentBefore` already captured at actuator entry.
- Wire the patch review actuator post-success boundary in `v1/src/modes/patch/review.ts` to call the same helper with its immutable-copy registry (empty or minimal today — hook only, no behavior change unless a registered path would fail validation).
- Add unit tests for the classifier/revert/re-validate helper: immutable-only recovery, mixed-failure no-recovery, no-op when validation passes, fallout line when verdict contains pinned `intent.md` reference.
- Add plan review integration (`commit: true`): actuator edits allowed subspec + dirties `intent.md` body/frontmatter → snapshot revert, re-validate, `plan: review: actuator` commit proceeds, stderr notice emitted.
- Add plan review integration (`commit: false`): same drift → snapshot write revert, phase success, stderr notice.
- Add regression: unrelated `validateReviewOutput` failure (e.g. deleted `index.md`) still fails with no recovery.
- Add regression: invalid blocker composite on `intent.md` (frontmatter edit plus `## Blocker`) still hard-fails with no recovery (`review.sandbox-unrunnable.test.ts` frontmatter+blocker case).
- Update docs listed below.

## Acceptance criteria

- [ ] When plan review actuator agent success is followed by `validateReviewOutput` failure only because registered `intent.md` drifted from its pre-actuator snapshot (non-blocker body/frontmatter edit), Jarvis writes pre-actuator snapshot bytes back to `intent.md`, re-validates successfully, keeps allowed spec/`verdict-plan.md` edits, and completes the review pass (commit/push when `commit: true`, phase success when `commit: false`).
- [ ] `commit: true` integration: immutable-only `intent.md` drift recovers via snapshot write, re-validate passes, and `plan: review: actuator` commit proceeds.
- [ ] `commit: false` integration: same drift recovers via snapshot write before phase success; stderr notice emitted.
- [ ] When immutable drift coexists with any other `validateReviewOutput` failure (e.g. missing `index.md`), Jarvis does not recover and the pass still fails with the current error behavior.
- [ ] When `intent.md` changes include an invalid blocker composite (e.g. frontmatter edit plus `## Blocker`), Jarvis does not recover and hard-fails as today.
- [ ] Recovery emits a stderr notice with a fixed prefix and a line naming the reverted `intent.md` path; when the verdict text contains literal or backtick-wrapped `intent.md` (case-sensitive), the notice includes a fallout line that those verdict requirements were not applied.
- [ ] Patch review actuator post-success path invokes the shared recovery hook; with today's registry, existing completed-spec revert and commit behavior are unchanged (`review.sandbox-unrunnable.test.ts` actuator preservation tests stay green).
- [ ] Helper unit tests cover immutable-only recovery, mixed-failure no-recovery, no-op when validation already passes, and fallout detection for pinned `intent.md` verdict references.

## Documentation updates

- `v1/docs/plan-mode.md`: review actuator immutable-copy overreach recovery (snapshot revert-and-continue); stderr notice shape (fixed prefix, per-path reverted lines, optional fallout line when verdict references `intent.md`); valid blocker-only append unchanged; recovery does not run for invalid blocker composites.
- `v1/docs/operator-runbook.md`: transient-killed plan recovery — note harness auto-recovers actuator-time immutable-copy overreach (revert-and-continue with notice); do not instruct manual `intent.md` revert; existing `index.md` reconcile guidance unchanged.
- `v2/docs/v1-behaviors.md`: plan review actuator immutable-overreach recovery entry; patch actuator shared-hook footnote.
