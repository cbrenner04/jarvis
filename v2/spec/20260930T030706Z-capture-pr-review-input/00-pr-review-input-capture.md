# 00 - PR review input capture

## Problem

Open PR review threads and inline comments exist only on GitHub until something copies them into the lane worktree. Downstream review-feedback work needs one refreshed, machine-readable artifact with stable per-item identities.

## Decisions

- Durable artifact path is `<laneWorktree>/.jarvis-pr-review-input.json`, following the root `.jarvis-*` sidecar convention (like `.jarvis-plan-stage`) — rules out a `.jarvis/` subdir, paths inside the published spec tree, or completion commits (sidecar only, never agent landing output).
- Capture input is the open PR only: inline review threads (GraphQL `reviewThreads`) plus top-level PR conversation comments (`gh pr view --json reviews,comments`) — rules out CI check-runs, operator verdict files, or subagent output.
- Resolved threads (`isResolved: true`) are excluded — rules out capturing already-settled feedback.
- Outdated threads (`isOutdated: true`) are kept, each captured item in them flagged `outdated: true` (others `outdated: false`) — rules out silently dropping feedback whose anchor moved.
- Comments whose author login ends in `[bot]` are dropped, in threads and top-level; a missing author is kept as `unknown` — rules out bot noise as actionable input.
- A thread left with zero comments after bot filtering is dropped — rules out empty thread records.
- Top-level comments are kept only when created at or after the latest submitted review's `submittedAt`; with no submitted review, all are kept — rules out re-capturing conversation already answered by a review.
- Comments are ordered by `createdAt` within a thread; threads by first comment `createdAt`; top-level comments by `createdAt` — rules out GitHub response order leaking into the artifact.
- Each captured thread carries GitHub GraphQL `id` as `threadId`; each captured comment carries GitHub `id` as `commentId` — rules out position-only or author/body hashes as traceability keys.
- `gh` IO goes through an injectable `AsyncSubprocessRunner` on the capture API — rules out live GitHub in unit tests (same seam pattern as `v2/src/commands/cleanup.test.ts` PR fixtures).
- Refresh overwrites the artifact atomically (write temp file in the same directory, then rename) — rules out append-only logs that duplicate items across runs.
- JSON carries a `captureVersion: 1` top-level field; thread and comment bodies record author, timestamps, path, line, and diff hunk fields when GitHub supplies them — rules out markdown-only capture that later consumers must re-parse.
- Deferred to first consumer: behavior when capture finds zero actionable items — pin when the review-feedback write prompt is authored.

## Tasks

- Add `v2/src/execution/pr-review-input-capture.ts` (or adjacent seam name) exporting capture + artifact path resolution.
- Implement GraphQL thread fetch (including `isResolved`, `isOutdated`, ids) and `gh pr view --json reviews,comments` top-level fetch on `AsyncSubprocessRunner`; surface `gh` failures as thrown errors with stderr context.
- Implement atomic refresh to `.jarvis-pr-review-input.json`.
- Add `v2/src/execution/pr-review-input-capture.test.ts` with a mocked `gh` fixture covering an unresolved thread (multi-comment), a resolved thread, an outdated thread, a bot comment, and top-level comments before/after the latest review; assert written JSON includes stable `threadId` / `commentId` values from the fixture.

## Acceptance criteria

- [ ] `pr-review-input-capture.test.ts` test `refresh writes actionable PR review threads and comments with stable GitHub ids` fails against the pre-fix code (no capture module) and passes after implementation.
- [ ] Test `resolved threads are excluded from the artifact` passes: a fixture thread with `isResolved: true` is absent from the written JSON.
- [ ] Test `outdated threads are kept and flagged outdated` passes: a fixture thread with `isOutdated: true` is present and each of its items carries `outdated: true`.
- [ ] Test `bot comments and pre-review top-level comments are dropped` passes against the fixture.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — `.jarvis-pr-review-input.json` sidecar: path, schema (`captureVersion`, `threadId`/`commentId`, `outdated`), filter rules, atomic refresh.
- `v2/docs/v1-behaviors.md` — record the v2 capture behavior (stable ids, outdated flag, sidecar artifact) against the v1 review-feedback filtering.
