# Cap `exit_reason` and `warnings` in invocation telemetry

The invocation-completed record builder in `shared/invocation/execute.ts` copies non-ok `result.stderr` verbatim into `exit_reason` (cursor quota exits embed full transcripts, rows up to 19 MB). `logBindingInbound` already writes that stderr to the session log, so capping `exit_reason` loses no reachable text when a session log is attached and its write succeeds — both are best-effort already (`sessionLog` is optional, and `SessionLog.append` degrades to a no-op on failure).

## Decisions

- Cap applies at record build time in `shared/invocation/execute.ts`, not in the JSONL sink — rules out per-sink divergence.
- Cap constant `TEXT_FIELD_CAP_CHARS = 4096`. A field over the cap becomes `` `[truncated, dropped ${droppedChars} chars] ` `` followed by the tail, with marker + tail together equal to `TEXT_FIELD_CAP_CHARS` (marker counts toward the cap) — rules out head-keeping, since the tail holds the actual quota/error line.
- Each `warnings` entry is capped independently with the same helper; array length unchanged — rules out dropping entries.
- Oversized `warnings` text has no full-text retention: `logBindingInbound` never writes `warnings` to the session log today (only `stdout`/`stderr`), and adding a warnings channel there is out of scope for this subspec — rules out treating warnings like `exit_reason`, whose backstop already exists.
- Session-log inbound writes for `stderr` (the `exit_reason` source) stay untruncated at the `logBindingInbound` call site — rules out moving truncation into the session-log append path, which would remove the only full-text backstop the capped `exit_reason` relies on.
- Other telemetry writers (e.g. `work_boundary_recorded`) are out of scope — only `createInvocationCompletedRecord`'s `exit_reason`/`warnings` fields for `invocation_completed` rows are touched.
- When no session log is attached, or its append silently no-ops (open/write failure), the untruncated `exit_reason` text is lost — accepted, since session logs are already best-effort observability, not a durable store.
- The session log itself is retained only for its cleanup window (default 14 days, `cleanup.sessionLogRetentionDays`), not durably — the full-text backstop is time-bounded, not permanent.

## Acceptance criteria

- [x] A test in `shared/invocation/execute.test.ts` drives a `quota`-kind invocation whose single-line `stderr` exceeds the cap and asserts the appended record's `exit_reason` equals the marker plus the stderr tail (combined length `TEXT_FIELD_CAP_CHARS`), and that the session log file contains the full untruncated stderr line; it fails against the pre-fix code.
- [x] A test in `shared/invocation/execute.test.ts` drives an `ok`-kind invocation whose `warnings` array holds one oversized entry and one under-cap entry, and asserts the oversized entry is capped the same way (marker + tail), the under-cap entry is unchanged, and the array length is unchanged; it fails against the pre-fix code.
- [x] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — cap on `exit_reason`/`warnings`, exact marker format, `exit_reason` full text lives in the session log (joined by `run_id` + the session-log open timestamp in its filename, not `attempt_id`) for the log's retention window only; `warnings` text has no full-text backstop.
- `v2/docs/v1-behaviors.md` — record the telemetry field cap.
