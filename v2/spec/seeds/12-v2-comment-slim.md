---
name: v2-comment-slim
---

# Comment slim to the amended documentation standard

Apply seed 01's standard to existing v2 src: cut narration that restates names/types/bodies; keep constraint comments. ~200–250 of 628 comment lines qualify. Comments only — zero behavior or signature changes.

## Decisions

- Primary targets: `tui-monitor-types.ts` (59 comment lines on 111 — the same 3–4-line inline-error block repeated per `TuiMonitorControls` method → one type-level sentence); `tui-daemon-client.ts` (per-method `@throws` ×5 restating the type-level note); `daemon.ts` (JSDoc blocks on `createTailStreamHandler`/`createRunControlHandlers` restating 20-line functions); `log-stream.ts` (per-event-type narration).
- Sweep the rest of v2/src with the same rule; when in doubt, keep.
- Explicit keep-list (load-bearing constraints): revision-inactive-statuses rationale (daemon.ts), snapshot-grafting guard (workflow-runner.ts), telemetry-presence rule (write-loop.ts), review-debate read-only convention (review-debate.ts). (log-stream's watch-before-scan note is moot if seed 11 removed the watcher.)

## Out of scope

- Test-file comments; doc files; any code change.

## Ordering

12 — after 11 (don't polish comments on code 11 deletes).
