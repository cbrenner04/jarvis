# Review-feedback write prompt and sidecar contract include review-body ids

## Problem

`review-feedback.prompt.write` tells the agent that captured input and the response sidecar use only thread `threadId` and top-level `commentId`, so review-body items in the artifact are invisible in the write-step contract even after capture persists them.

## Decisions

- Update `prompts/review-feedback/write.md` captured-input prose to list review threads, top-level comments, and submitted review bodies as addressable capture kinds — rules out implying only inline threads count as feedback.
- Response sidecar instructions name `reviewId` alongside `threadId` and top-level `commentId` for `- <id>: addressed` / `: declined:` lines — rules out a separate sidecar format for review bodies.
- Bump the prompt template `revision` when the body changes — rules out silent registry drift without a revision tick.

## Tasks

- Edit `prompts/review-feedback/write.md` (captured review input + response sidecar sections).
- Extend `shared/prompts/review-feedback-write.test.ts` to assert the rendered write prompt mentions review-body ids in the sidecar contract alongside thread and comment ids.

## Acceptance criteria

- [x] `shared/prompts/review-feedback-write.test.ts` adds or extends a case that renders `buildReviewFeedbackWritePrompt` and asserts the prompt names review-body `reviewId` values in the response sidecar contract alongside thread `threadId` and top-level `commentId`; fails against current code.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/prompts.md`: review-feedback write step sidecar contract includes review-body `reviewId` values.
- `v2/docs/workflow-runner.md`: `review-feedback` workflow sidecar line contract includes review-body ids (not only `threadId|commentId`).
