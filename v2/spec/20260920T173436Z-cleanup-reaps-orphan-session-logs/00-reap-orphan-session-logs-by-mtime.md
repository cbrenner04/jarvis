# Reap orphan session logs by mtime, streamed

`discoverExpiredSessionLogs` in `v2/src/commands/cleanup.ts` skips any `.log` whose run id is absent from the state store (or whose basename fails `SESSION_LOG_NAME_PATTERN`), so orphaned logs are never reclaimed. It also reads the whole sessions directory into an array before filtering.

## Decisions

- Orphan = regular `.log` file directly under the sessions dir whose basename parses to a run id with no row in the store; the unparseable-basename case is a boundary that takes the same rule. Reap it when its mtime is older than the same cutoff. Rules out a separate orphan retention knob.
- A log whose run row exists keeps today's rule exactly: terminal + finite `finishedAt` older than cutoff. A live (non-terminal) or `finishedAt`-less row still protects its logs — never fall back to mtime there, or a long-running run loses its own log.
- The run row is written before its log is opened (the log basename embeds the id `createRun` returns), so a live row always exists for a log being written.
- The mtime fallback is suppressed when the store yields zero run rows; row-based reaping continues unchanged. Rules out a store that opens empty (wrong path, fresh install, failed read) making every log look orphaned and mass-deleting on first apply. A partially populated store is not detectable and is out of scope.
- mtime is not creation time and can be pushed forward by copy/restore/migration; orphan aging is not equivalent to `finishedAt` aging and only errs toward keeping.
- Iterate with `opendirSync`, stat-ing and classifying per entry, instead of `readdirSync`-then-filter. Memory-shape preference only — no performance claim; run rows are still materialized in full. Rules out keeping the entries array for sorting.
- The directory handle is closed on every path, including a throw from the per-entry `stat`; use `try/finally`.
- Unreadable/vanished entries stay skipped as today.
- No hand purge of already-leaked fixtures; the fallback reaps them once aged.
- Summary keeps the `Found`/`Reaped …expired session log(s)…` line and counts orphans in the same aggregate; when at least one orphan is included, the line gains a `(M by mtime, no run row)` suffix before the colon. Rules out a separate output line or format, and rules out an unmarked aggregate for a bulk first-apply delete.

## Acceptance criteria

- [x] `jarvis cleanup` reaps a session log with no matching run row whose mtime is older than the retention window, and keeps one whose mtime is inside the window; a new test in `v2/src/commands/cleanup.test.ts` covers both and fails against the pre-fix code.
- [x] A log owned by a non-terminal run row is preserved regardless of mtime; pinned by a test that fails against a naive mtime-only fallback.
- [x] A log whose basename does not parse but is older than the window is reaped; pinned by a test that fails against the pre-fix code.
- [x] With a store holding zero run rows and old logs in the sessions dir, nothing is reaped; pinned by a test that fails against a naive mtime fallback.
- [x] With orphans present, the dry-run and apply summaries show the orphan count via the `(M by mtime, no run row)` suffix on the existing line; pinned by a test that fails against the pre-fix code. With no orphans the line is unchanged.
- [x] Existing session-log retention tests in `v2/src/commands/cleanup.test.ts` stay green (terminal-run expiry, invalid-retention skip, dry-run summary without orphans).
- [x] `bun run typecheck`, `bun run test:v2`, `bun run test:shared`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Session-log retention: invert "file mtime and filename timestamps are not used" in **Retention window** (mtime now ages orphans; `finishedAt` still ages logs with a row); extend the **Reap-eligible** conjunction with the orphan case and the zero-rows suppression; remove "unparseable basenames, unknown run ids" from the **Preserved** paragraph (live/non-terminal, `finishedAt`-less rows and young orphans stay preserved); update **Reporting** for the orphan suffix.
- `v2/docs/v1-behaviors.md` — cleanup session-log retention entry (`[v2 additive] Cleanup session-log retention`): invert "file mtime and filename timestamps are not used" and the *preserved* listing of "unparseable basenames, unknown run ids"; record the mtime fallback, the zero-rows suppression, and the summary suffix.
