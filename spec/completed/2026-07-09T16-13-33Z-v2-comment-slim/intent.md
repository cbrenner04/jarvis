---
name: v2-comment-slim
---
# V2 Comment Slim

# Comment slim v2/src to the amended documentation standard

## Prerequisites

- seed 01's amended comment/documentation standard is committed and in effect
- seed 11's watcher removal (if applicable) has landed, so log-stream.ts's watch-before-scan comment status is settled

## Decisions

- Comments-only change; zero behavior or signature changes.
- Cut narration that restates names/types/bodies; keep constraint comments (the "why", not the "what").
- Primary targets: `tui-monitor-types.ts` (collapse repeated per-method inline-error block into one type-level sentence); `tui-daemon-client.ts` (drop per-method `@throws` restating the type-level note); `daemon.ts` (trim JSDoc blocks on `createTailStreamHandler`/`createRunControlHandlers` restating their bodies); `log-stream.ts` (trim per-event-type narration).
- Sweep the rest of v2/src under the same rule; when in doubt, keep.
- Explicit keep-list (load-bearing constraints, do not touch): revision-inactive-statuses rationale (daemon.ts), snapshot-grafting guard (workflow-runner.ts), telemetry-presence rule (write-loop.ts), review-debate read-only convention (review-debate.ts).

## Out of scope

- Test-file comments; doc files; any code change.
