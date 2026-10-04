# Review-feedback lane republication

## Problem

No workflow-runner completion path republicates review-feedback writes to the lane's existing open PR using entry-run publication semantics.

## Prerequisites

- Subspecs `00-review-feedback-write-prompt-corpus.md`, `01-review-feedback-workflow-step-and-bindings.md`, and `02-review-feedback-dispatch.md`.

## Decisions

- Republication reuses the existing `findOrCreatePr` path: with the write step's `baseRef` = the lane PR base (subspec `01`), `resolveOpenDraftPr` resolves the lane PR by branch + base — rules out a new PR-number publisher input or a sibling PR on the same branch.
- Republication `publicationPath` and landing narrative come from the **entry run** for the recorded `entryRunId` / `entrySpecPath`, mirroring the original lane kind's completion publication (intent → ready-intents landing; plan → spec tree; implement → implement spec / code landing) — rules out `writeStepRun?.specPath ?? completionStep.specPath` when that would be the review-feedback write sidecar without a `reviewFeedbackLane` branch.
- On `done` and `no-work`, run the configured ready gate, diff-derived mutation verification, and completion publication in the same order as other write workflows for that role — rules out skipping mutation verification for review-feedback.
- Successful capture with zero actionable items still admits the write step; terminal `no-work` runs the same completion tail as `done` — rules out refusing admission or skipping republication for empty actionable sets.
- Drop operator/doc references to `review_feedback_write_not_available` as a steady-state outcome; keep the code only for genuine preparation/start failures — rules out documenting a permanent stub.
- `bun run test:integration:v2` stays green with no new integration test; republication behavior is guarded by unit tests in this slice — rules out an ambiguous intent-level integration obligation.

## Tasks

- Implement workflow-runner publication tail branch for `reviewFeedbackLane` metadata (override `publicationPath` / publisher inputs away from the write sidecar).
- Add `review-feedback-republication-path.test.ts` (or equivalent) asserting completion publication uses entry-run spec paths and would fail if production took `writeStepRun?.specPath ?? completionStep.specPath` without the review-feedback branch — reachable on `workflow-runner.ts` publicationPath fallback today.
- Add `review-feedback-write-run.test.ts` under `v2/src/execution/` driving the preset through a mocked agent write loop and mocked completion publisher for intent, plan, and implement fixtures: assert commits stay on the admitted branch, the publisher resolves the lane PR through branch + `baseRef`, rendered prompts include review artifact text and per-kind context without implement index-routing bindings, and empty actionable capture reaches `no-work` with completion tail invoked.
- Update docs and v1-behaviors catalog.

## Acceptance criteria

- [x] `review-feedback-republication-path.test.ts` (or the named test therein) fails against the pre-fix `publicationPath` fallback and passes after the `reviewFeedbackLane` branch; it asserts entry-run spec paths drive publication, not the write-step sidecar.
- [x] `review-feedback-write-run.test.ts` fails against the pre-fix absence and passes after implementation; it covers intent, plan, and implement lanes with assertions for branch, existing PR publication target, review artifact injection, absence of implement index-routing bindings in rendered prompts, and `no-work` after empty actionable capture running the completion tail.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — review-feedback preset single write step, prompt ids, snapshot `reviewFeedbackLane`, ready gate + mutation verification + republication to the lane PR.
- `v2/docs/operator-runbook.md` — starting `jarvis run workflow review-feedback` after publication (remove steady-state `review_feedback_write_not_available` note; describe write + republish behavior; note `review_feedback_lane_in_flight` when another run already holds the lane branch; add `review_feedback_pr_not_draft` to the review-feedback code table: operator-flipped lane PR, mark it draft again to proceed).
- `v2/docs/v1-behaviors.md` — record v2 review-feedback write dispatch and same-PR republication versus v1 `review-feedback` worktree command.
