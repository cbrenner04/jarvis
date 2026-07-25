# 00 - Instrument and promote intent finalization

## Problem

Reviewed `jarvis run workflow intent` runs leave finished markdown in `.jarvis-intent-stage/` with no
transactional move into the configured durable output directory (`intentOutput.durableDir` / landing
`output.durableDir`), no verdict sidecar cleanup, and no completion commit on the intent branch.
`workflow-runner.md` still documents that an empty critic verdict converges to `complete` without
landing — that contract conflicts with this intent and is a plausible contributor to stranded stages.
Inline review landing exists in isolation (`workflow-runner.test.ts` `"runs reviewed-intent review and
landing only in the split workspace"`) but the full split → review → completion tail does not reliably
publish; this slice must not close by extending only that isolated step. The failure discriminator in
production is still unknown; ship wanted promotion and branch tracing before settlement and recovery
slices land. Structured `intent_finalization` traces remain required even when promotion fixes known
gaps (e.g. empty-verdict tail skip) so production can still explain any remaining short-circuit.

**Paired control, 2026-07-25 13:40–13:41 UTC.** Two intent runs on one daemon, same agent order, same
two-staged-file shape, launched seconds apart — one promoted, one did not:

| intent | critic | actuator | settle after actuator | outcome |
| --- | --- | --- | --- | --- |
| `real-clock-races…` | ok 38.7s | ok 19.9s | 1.151s | **failed**, stage stranded |
| `persisted-snapshot…` | ok 43.1s | ok 24.4s | 1.356s | **completed**, PR #2153 |

This is stronger evidence than the earlier six-failure table and it kills three candidate
discriminators at once: the actuator ran `exit_kind: ok` in **both**, staged-file count was 2 in
**both**, and the ~1.2 s finalization tail is present in **both** — so neither actuator invocation,
nor file count, nor the settle interval separates success from failure. Note in particular that the
empty-verdict path was *not* taken by the failing run (its critic returned a non-empty verdict and the
actuator ran), so fixing the empty-verdict tail skip alone will **not** close this defect. Treat the
discriminator as genuinely unknown and let the trace identify it.

## Decisions

- One promotion contract on both seams — review-step landing when configured and the workflow
  completion publication tail each perform promote → verdict cleanup → git-enabled commit/push/PR when
  enabled; rules out fixing only shared trace logging while one seam still skips promotion.
- Promotion copies every `.jarvis-intent-stage/*.md` into the resolved `durableDir` from workflow
  configuration (not a hard-coded `ready-intents/` literal), removes `.jarvis-intent-stage/`,
  `.jarvis-intent-review-verdict.md`, and `.jarvis-intent-review-verdict.md.owner`; rules out leaving
  the stage as operator-visible output.
- An approving empty verdict still runs the full git-enabled completion publication tail (commit and,
  when enabled, push/draft PR) after promotion; document how completion attributes publication when
  the actuator did not run; rules out promotion-only review landing with the tail skipped.
- Promotion runs when the critic approves with an empty verdict and the actuator is skipped; rules
  out gating on `actuatorRan` or non-empty verdict text.
- Append a structured run-log `intent_finalization` event on every finalization attempt with `phase`,
  `branch`, and optional `stopReason` (non-empty when promotion does not complete); rules out fixing
  promotion without observability. Deferred to first consumer: exact `phase` / `branch` enum strings —
  pin when the first trace assertion is written.
- Scope is promotion + tracing only; dishonest `boundary_committed` / `invocation_failure` labels and
  resume admission stay in subspecs 01–02.

## Tasks

- Extract or extend a shared finalization entry used by review landing and the completion tail; both
  seams call it for promotion and trace emission (one code path, not duplicate logs).
- Wire the full split + reviewed intent workflow on the external intent worktree so staged files
  publish through both seams per the contract above — distinct from extending the existing
  single-step `"runs reviewed-intent review and landing only in the split workspace"` test.
- Add workflow regressions: two-file full-workflow promotion, empty-verdict promotion (must fail if
  only review landing runs and the completion tail is skipped), trace on success and short-circuit.
- Update durable docs (primary: `workflow-runner.md`) for transient stage vs configured `durableDir`,
  unconditional promotion, and `intent_finalization` field semantics (`phase`, `branch`, `stopReason`).

## Acceptance criteria

- [ ] `workflow-runner.test.ts` `"promotes two staged intents through a full reviewed intent workflow"`
  drives split (two `.jarvis-intent-stage/*.md`) plus succeeding review roles, asserts both files under
  the configured `durableDir`, stage and both verdict sidecars absent, and a new commit on the intent
  branch containing the promoted paths; fails against pre-fix code.
- [ ] `workflow-runner.test.ts` `"promotes staged intents when the critic returns an empty verdict"`
  asserts the same promotion, cleanup, commit, and completion-tail publication hooks used elsewhere for
  git-enabled intent workflows (push/PR stubs or equivalents), with zero actuator invocations; fails if
  only review landing runs and the completion tail is skipped; fails against pre-fix code.
- [ ] `workflow-runner.test.ts` `"records intent finalization trace on success and when promotion stops
  short"` asserts at least one `intent_finalization` log event with `branch` on the happy path and a
  `stopReason` when finalization is injected to fail before promotion; inverting trace emission fails
  the test.
- [ ] Inverting the promotion guard in the finalization path fails
  `"promotes two staged intents through a full reviewed intent workflow"` (staged files remain).
- [ ] The guard-inversion proof lives **in that two-file workflow test itself**, not only via a
  `promote = false` path in the trace test: disabling promotion must leave staged markdown in
  `.jarvis-intent-stage/` and turn that named test red.
- [ ] An intent workflow whose **last step is `review-debate`** (not light `review`) runs the same
  `workflow_completion` promotion, verdict cleanup, tracing, and landing-failure settlement as the
  light-review path; a test covering debate-last intent fails against a tail guard narrower than
  `isReviewLastStep`.

## Documentation updates

- `v2/docs/workflow-runner.md` — replace “empty verdict converges without landing” with the publication
  contract: `.jarvis-intent-stage/` is transient, configured `durableDir` is durable output,
  promotion is not conditional on actuation; document operator-readable `intent_finalization` fields
  (`phase`, `branch`, `stopReason`).
- `v2/docs/write-behavior.md` — only if a conflicting reviewed-intent landing bullet remains after the
  `workflow-runner.md` edit.
- `v2/docs/v1-behaviors.md` — catalog intent stage promotion and durable-dir output (subspecs 01–02
  extend settlement and resume entries).
