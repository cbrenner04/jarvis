# Month-shard the session-log writer

## Behavior

`openSessionLog` resolves its target file to `<sessionsDir>/<YYYY-MM>/<namespace>-<timestamp>.log`, where `<YYYY-MM>` is the UTC year and month of the injected clock's value at open time. The basename is unchanged, appends still land in an existing file for the same namespace/timestamp/month, and every directory- or open-level failure still degrades the writer to a silent no-op sink.

## Decisions

- Shard key comes from `clock()` evaluated once at open, not from parsing the `timestamp` argument — the argument is an opaque caller-formatted string with no parse contract, while the clock is already the injected time source the tests control.
- UTC month via the ISO string's `YYYY-MM` prefix, not local-time getters — log lines are stamped in UTC, so a local-time shard would disagree with the timestamps inside the file.
- `mkdirSync(..., { recursive: true })` targets the shard dir, so the parent sessions dir is still created implicitly; no separate pre-create step.
- Readers split in two. Nothing in `v2/src` computes a session-log path independently of `openSessionLog`, so v2 callers are unaffected. `scripts/real-home-guard.ts`'s session snapshot walks `sessions/` at depth 0 only; after sharding, every leak but the first per month lands inside an already-known month entry and diffs to nothing, so its walk depth goes 0 → 1 here (mirroring the bounded `specs/` recursion already in that file) to keep the tripwire sensitive. The cleanup reaper (direct children of `sessionsDir` only) is the one reader left unchanged — it is a different module-boundary surface, and the resulting regression is accepted and documented per `index.md`, not silently absorbed.

## Tasks

- [x] Shard the open path in `shared/invocation/session-log.ts`.
- [x] Extend `shared/invocation/session-log.test.ts` with injected-clock shard coverage, unchanged basename, append-to-existing, shard-level failure degradation, first-run shard creation, and a fixed-TZ UTC-vs-local case; update the existing flat-path assertions and the `JARVIS_HOME` test to expect the shard.
- [x] Bump `scripts/real-home-guard.ts`'s `snapshotRealHome` sessions walk from depth 0 to depth 1 and extend `scripts/real-home-guard.test.ts` accordingly.
- [x] Documentation updates below.

## Acceptance criteria

- [x] A `session-log.test.ts` test with an injected clock asserts the log file is created at `<sessionsDir>/<YYYY-MM>/<namespace>-<timestamp>.log` for that clock's UTC month and that no `.log` file sits directly under `<sessionsDir>`; it fails against the flat writer.
- [x] A test asserts the basename is still `<namespace>-<timestamp>.log`, unchanged from the pre-shard writer.
- [x] A test asserts two sequential `openSessionLog` calls with the same namespace, timestamp, and clock month append to one file inside that month shard rather than truncating or creating a second file.
- [x] A test run under a fixed non-UTC `TZ` (e.g. `America/Los_Angeles`) with a clock instant whose UTC and local dates fall in different months (e.g. `2024-02-01T03:00:00.000Z`, which is `2024-01-31` local) asserts the log shards under the UTC month (`2024-02`), not the local month (`2024-01`); it fails against a local-time-getter implementation.
- [x] A test asserts an unwritable *shard* path — a regular file at `<sessionsDir>/<YYYY-MM>` for the injected clock's month, with `<sessionsDir>` itself a normal writable directory — still yields a writer whose `append` and `close` do not throw. (A regular file at `<sessionsDir>` itself throws identically before and after this change and exercises no new code, so it does not substitute for this case.)
- [x] A test asserts that when neither `<sessionsDir>` nor its month shard exists at open time, `openSessionLog` creates both in one step and the log lands in the shard — exercising the recursive-`mkdirSync` decision directly rather than incidentally.
- [x] The no-`sessionsDir` test asserts the log lands under `<JARVIS_HOME>/sessions/<YYYY-MM>/` with `JARVIS_HOME` pointed at a scratch dir.
- [x] A `real-home-guard.test.ts` test asserts a new log written to `<homeDir>/sessions/<YYYY-MM>/leak.log`, where that month directory already exists in the baseline snapshot, is flagged by `diffRealHomeSnapshots`; it fails against the depth-0 walk and passes once the walk descends to depth 1.
- [x] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — update the `openSessionLog` path description from `<sessionsDir>/<namespace>-<timestamp>.log` to the sharded form.
- `v2/docs/daemon-host.md` — update the invocation-session-logs path description to the sharded form.
- `v2/docs/invocation-liveness.md` — update the session-log path reference to the sharded form.
- `v2/docs/first-workflow-walkthrough.md` — update the path description and fix the `ls -t ~/.jarvis/sessions/<run-id>-*.log` lookup recipe, which silently returns nothing post-shard, to search across both the flat legacy layout and month shards.
- `v2/docs/install-and-config.md` — update the `cleanup.sessionLogRetentionDays` table row: reaping still applies to pre-existing flat logs but no longer reaches any newly-opened (sharded) log.
- `v2/docs/operator-runbook.md` — session logs live in `~/.jarvis/sessions/<YYYY-MM>/`; give the lookup recipe for finding a run's log across shards, and correct the cleanup session-log retention section to state that the reaper's direct-children scope makes every post-shard log permanently non-reap-eligible until a future reaper-surface change, not merely delayed.
- `v2/docs/telemetry-capture.md` — update the `exit_reason` session-log join path to the sharded location, and correct the "time-bounded to the log's cleanup window ... not permanent" claim with a one-line pointer to the operator-runbook correction above, without restating the reaper's mechanics.
- `v2/docs/v1-behaviors.md` — update the v2-ported session-log bullet with the sharded layout, and correct the cleanup-retention bullet to state new logs are never reap-eligible post-shard (not just that the reaper's scope is unchanged).
- `v2/docs/test-writing.md` — record that `real-home-guard.ts`'s sessions snapshot now walks one level deep, and why (sharded leaks past the first per month were otherwise invisible).
