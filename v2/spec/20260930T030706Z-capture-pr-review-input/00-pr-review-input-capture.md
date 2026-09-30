# 00 - PR review input capture

## Problem

Open PR review threads and inline comments exist only on GitHub until something copies them into the lane worktree. Downstream review-feedback work needs one refreshed, machine-readable artifact with stable per-item identities.

## Decisions

- Durable artifact path is `<laneWorktree>/.jarvis/pr-review-input.json` — rules out paths inside the published spec tree or completion commits (sidecar only, never agent landing output).
- Capture input is the open PR only: unresolved inline review threads (with their inline comments) plus eligible top-level PR review comments using the same actionable filters as v1 `collectActionableReviewFeedback` (`v1/src/review-feedback.ts`) — rules out CI check-runs, operator verdict files, or subagent output.
- Each captured thread carries GitHub GraphQL `id` as `threadId`; each captured comment carries GraphQL `id` as `commentId` — rules out position-only or author/body hashes as traceability keys (reachable on v1 today: thread/comment records carry no stable id, which blocks slice-4 traceability).
- `gh` IO goes through an injectable `AsyncSubprocessRunner` on the capture API — rules out live GitHub in unit tests (same seam pattern as `v2/src/commands/cleanup.test.ts` PR fixtures).
- Refresh overwrites the artifact atomically (write temp file in the same directory, then rename) — rules out append-only logs that duplicate items across runs.
- JSON carries a `captureVersion: 1` top-level field; thread and comment bodies record author, timestamps, path, line, and diff hunk fields when GitHub supplies them — rules out markdown-only capture that later consumers must re-parse.
- Deferred to first consumer: behavior when capture finds zero actionable items — pin when the review-feedback write prompt is authored.

## Tasks

- Add `v2/src/execution/pr-review-input-capture.ts` (or adjacent seam name) exporting capture + artifact path resolution.
- Port/adapt v1 GraphQL thread fetch and `gh pr view --json reviews,comments` top-level fetch onto `AsyncSubprocessRunner`; surface `gh` failures as thrown errors with stderr context.
- Implement atomic refresh to `.jarvis/pr-review-input.json`.
- Add `v2/src/execution/pr-review-input-capture.test.ts` with a mocked `gh` fixture covering at least one unresolved thread (multi-comment) and one eligible top-level comment; assert written JSON includes stable `threadId` / `commentId` values from the fixture.

## Acceptance criteria

- [ ] `pr-review-input-capture.test.ts` test `refresh writes actionable PR review threads and comments with stable GitHub ids` fails against the pre-fix code (no capture module) and passes after implementation.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- None (operator-facing capture location is documented in subspec `01`).
