# `shared/invocation` spawns claude with stream-json and records its cost

repo: cbrenner04/jarvis

- [ ] [00 - Shared claude binding spawns stream-json and parses the terminal result event](./00-claude-stream-json.md)
- [ ] [01 - `invocation_completed` records agent-reported usage and cost](./01-record-usage-and-cost.md)

## Notes

The intent's second decision ("stream events bump the watchdog's last-output
timestamp; a v2 claude invocation records a non-null `last_output_age_ms`") is
not implementable as written: v2 has no idle-output watchdog and no
`last_output_age_ms` telemetry field. `v2/src/execution/write-loop.ts` arms only
a wall-clock `iterationTimeoutMs`, and `InvocationCompletedRecord` has no
output-age field. Subspec 00 ships the prerequisite (claude output now arrives
incrementally instead of once at exit) and records the remaining gap in the
runbook; arming an idle watchdog in `shared/` is a separate behavior worth its
own intent.
