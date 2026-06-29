# Immutable-copy overreach recovery

## Problem

Plan review actuator runs after the adjudicator, then `validateReviewOutput` gates commit (`v1/src/modes/plan/review.ts`). When the actuator applies valid spec/verdict edits but also dirties an immutable copied input (today: `intent.md`), validation fails and the pass is discarded — including allowed subspec edits and a written `verdict-plan.md`.

## Decisions

- Recover only when post-actuator validation fails **solely** because one or more registered immutable-copy paths drifted from their pre-actuator snapshot; `index.md` deletion, boundary violations, mixed immutable + structural failures, and agent non-`ok` outcomes keep today's fail-the-pass behavior — rules out blanket validation bypass.
- Immutable-copy registry for plan review actuator: `intent.md` (byte-for-byte ready-intent copy; valid mutation remains append-only `## Blocker` with unchanged frontmatter per `isValidIntentModification`) — rules out treating numbered subspecs or `verdict-plan.md` as immutable copies in this slice.
- Revert each affected immutable path to its pre-actuator bytes on disk before commit (git checkout or direct write in no-commit layout); no second actuator invocation — rules out trusting prompt adherence or fallback-agent self-correction.
- After revert, re-run the same validation; proceed to the existing commit/push (or no-commit success return) only when re-validation passes — rules out committing with a still-invalid tree.
- Emit an operator-visible stderr notice naming each reverted path; when the verdict text explicitly targets `intent.md`, include a one-line fallout note that those requirements were not applied — rules out silent loss of review intent.
- Deferred to first consumer: general verdict-to-path fallout extraction beyond explicit `intent.md` targeting — pin when a caller needs it.
- Implement recovery in a shared review-layer helper; plan review actuator is the first consumer; patch review actuator registers immutable copies through the same hook at the post-success pre-commit boundary so future parity does not fork logic — rules out plan-only inline revert disconnected from patch actuation.
- Patch review's existing unconditional completed-spec revert after actuator success stays; this slice does not replace it — rules out refactoring patch spec revert into recovery or adding patch post-validation solely to exercise recovery.
- Valid `## Blocker` append on `intent.md` remains the existing success/stop path (no recovery branch) — rules out recovery masking genuine blocker handling.
- `commit: false` / external-spec plan review uses the same recovery and notice semantics before returning phase success — rules out commit-mode-only guard.

## Task checklist

- Add a shared helper (under `v1/src/modes/review/` or adjacent shared review code) that: accepts pre-actuator snapshots for registered immutable-copy paths, a post-actuator validation result, and revert/write callbacks; classifies immutable-copy-only failure; reverts; re-validates; returns recovered vs hard-fail.
- Wire the helper into the plan review actuator path in `v1/src/modes/plan/review.ts` after `runVerdictActuator` and before commit/skip-commit return.
- Register `intent.md` for plan review actuator via the helper; pass `intentBefore` already captured at actuator entry.
- Wire the patch review actuator post-success boundary in `v1/src/modes/patch/review.ts` to call the same helper with its immutable-copy registry (empty or minimal today — hook only, no behavior change unless a registered path would fail validation).
- Add unit tests for the classifier/revert/re-validate helper (immutable-only vs mixed failure vs clean pass).
- Add plan review integration coverage: actuator edits allowed subspec + dirties `intent.md` body/frontmatter → pass recovers, `intent.md` restored, subspec edits kept, `plan: review: actuator` commit (or no-commit success) proceeds, stderr notice emitted.
- Add regression: unrelated validation failure (e.g. deleted `index.md`) still fails the pass with no recovery.
- Update docs listed below.

## Acceptance criteria

- [ ] When plan review actuator agent success is followed by `validateReviewOutput` failure only because `intent.md` drifted from its pre-actuator snapshot (non-blocker body/frontmatter edit), Jarvis reverts `intent.md` byte-for-byte, re-validates successfully, keeps allowed spec/`verdict-plan.md` edits, and completes the review pass (commit/push when `commit: true`, phase success when `commit: false`).
- [ ] When the same failure mode also involves a non-immutable validation error (e.g. missing `index.md`), Jarvis does not recover and the pass still fails with the current error behavior.
- [ ] Recovery emits a stderr notice naming the reverted `intent.md` path; when the verdict text explicitly targets `intent.md`, the notice states that those verdict requirements were not applied.
- [ ] Patch review actuator post-success path invokes the shared recovery hook; with today's registry, existing completed-spec revert and commit behavior are unchanged (`review.sandbox-unrunnable.test.ts` actuator preservation tests stay green).
- [ ] Helper unit tests cover immutable-only recovery, mixed-failure no-recovery, and no-op when validation already passes.

## Documentation updates

- `v1/docs/plan-mode.md`: review actuator immutable-copy overreach recovery (revert-and-continue, notice, fallout when knowable); valid blocker append unchanged.
- `v1/docs/operator-runbook.md`: transient-killed plan recovery — drop manual `intent.md` revert guidance; note harness recovery during actuation when applicable.
- `v2/docs/v1-behaviors.md`: plan review actuator immutable-overreach recovery entry; patch actuator shared-hook footnote.
