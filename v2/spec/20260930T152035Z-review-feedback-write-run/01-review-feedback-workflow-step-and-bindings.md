# Review-feedback workflow step and write-loop bindings

## Problem

`buildReviewFeedbackWorkflowSteps` still points at `review-feedback.prompt.pending` and a fake `.jarvis/review-feedback-pending` artifact; the write loop has no review-feedback prompt rendering or lane-scoped bindings.

## Prerequisites

- Subspec `00-review-feedback-write-prompt-corpus.md`.

## Decisions

- Replace the pending stub with `review-feedback.prompt.write`, `review-feedback.rules` step rules, and `DEFAULT_WRITE_STEP_RULES` plus `STEP_RULES` from `review-feedback.rules` only (subspec `00`) — rules out keeping the placeholder prompt id or merging `implement.rules`.
- Lane resolution extends `ReviewFeedbackLaneTarget` with `entryRunId`, `entrySpecPath`, and `baseRef` from the matched completed lane (`entryRun.id`, and the entry row's first snapshot step `specPath` and `worktree.baseRef`); `prepareReviewFeedbackWorkflowAdmission` passes them into the builder — rules out the builder guessing paths from cwd/git alone.
- `entrySpecPath` meaning per kind: intent → that run's ready-intents root (`…/ready-intents`); plan → that run's admitted plan spec tree root; implement → that run's implement spec path (index or landed spec as stored on the entry step) — rules out using the review-feedback write sidecar as `entrySpecPath`.
- Write step `worktree` stays the resolved lane (`localPath`, `branchName`) with `baseRef` = the entry lane's `baseRef` (the PR base) and `git: true` when binding the persisted lane `worktreePath` — rules out `baseRef` = lane branch (empty `baseRef..HEAD` diff suppresses publication; `resolveOpenDraftPr` base filter misses the lane PR) and stub `git: false` that breaks diff/publication head reads in `workflow-runner.ts`.
- Write step `specPath` / `expectedArtifactPath` are harness sidecar paths under the lane worktree (`.jarvis/review-feedback-write` or equivalent), never the published spec tree — rules out writing review edits into the implement spec checkout as the step artifact contract.
- Persist `reviewFeedbackLane` on the workflow snapshot (lane kind, entry run id, entry spec path, `prNumber`, `prUrl`) for the publication tail in subspec `03` — rules out inferring republication targets only from git state.
- Write-loop prompt assembly calls `buildReviewFeedbackWritePrompt` when `promptId === "review-feedback.prompt.write"`; implement lanes skip linked-index resolution entirely for this prompt id — rules out routing through `resolveActiveLinkedSubspec`.
- Role mapping stays `implement` role for implement lanes and `plan` role for intent and plan lanes (existing `roleForLaneKind`) — rules out running intent lanes through the implement binding resolver.
- Lane resolution skips entry rows whose first snapshot step `promptId` is `review-feedback.prompt.write` (`bareLaneKindFromFirstStep` in `review-feedback-lane-resolution.ts`) — rules out a completed implement-lane review-feedback run (role `implement`) matching as a second lane and refusing the next round `review_feedback_lane_ambiguous`.

## Tasks

- Extend `ReviewFeedbackLaneTarget`, `ReviewFeedbackWorkflowInput`, and admission builder payload with `entryRunId`, `entrySpecPath`, and `baseRef`.
- Rewrite `buildReviewFeedbackWorkflowSteps` to load the real write step via `workflow-loader`.
- Resolve `review-feedback.prompt.write` placeholders in `executeWrite` (`v2/src/execution/write.ts`).
- Skip `review-feedback.prompt.write` entry rows in bare and pipeline lane resolution.
- Add unit tests on the builder for bare intent, plan, and implement lanes asserting prompt id, snapshot metadata, worktree binding (`git: true`), and sidecar artifact paths.
- Remove `review-feedback.prompt.pending` if nothing else references it.

## Acceptance criteria

- [ ] `review-feedback-workflow-steps.test.ts` (new) test `builds a write step for each lane kind with review-feedback.prompt.write` fails against the pre-fix stub and passes after implementation, asserting worktree branch/path, `worktree.baseRef` equal to the entry lane's `baseRef` (not the lane branch), `worktree.git: true`, snapshot `reviewFeedbackLane.prNumber`, and no pending prompt id.
- [ ] A test in the same file proves implement-lane steps do not carry linked-index routing bindings in the loaded write payload; it fails against the pre-fix absence and passes after the write-loop wiring.
- [ ] `review-feedback-lane-resolution.test.ts` case: an implement lane plus a completed review-feedback run on the same branch with PR evidence resolves to the implement lane (not `review_feedback_lane_ambiguous`); fails against pre-fix resolution.
- [ ] `review-feedback-workflow-admission.test.ts` lane-resolution and prelude refusal cases stay green after subspec `01` prompt-id expectation updates; dispatch expectation changes are subspec `02` only.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- None.
