# Tiered session-log retention in cleanup

## Problem

Session-log cleanup deletes eligible plain `.log` files in one step at `retention.sessions.coldDays`, ignores `hotDays`, and discovers only direct children of `sessionsDir`, so month-sharded logs never age.

## Decisions

- Three tiers: **hot** keeps eligible logs as plain `.log`; **cold** stores eligible logs as sibling `.log.gz` after the hot boundary; **gone** removes eligible `.log.gz` after the cold boundary — rules out retaining the single-window plain delete at `coldDays` only.
- Terminal-run logs age by durable `finishedAt` against `now - hotDays` and `now - coldDays`; eligible orphans age by file `mtime` on the same cutoffs — rules out mtime aging for owned terminal runs and rules out a single cutoff for both tiers.
- Reuse the existing basename pattern, terminal/non-terminal gating, and orphan classification (including zero-run-row orphan suppression) from `classifySessionLog` in `v2/src/commands/cleanup.ts`; rules out new eligibility rules or orphan semantics.
- Discovery collects regular `.log` and `.log.gz` candidates from direct children of `sessionsDir` and from direct children of each immediate subdirectory whose name matches `^\d{4}-\d{2}$`; rules out a recursive sessions walk and rules out continuing flat-only discovery.
- Hot-to-cold gzip replaces an eligible plain log with `<same-basename>.log.gz` in the same directory (standard gzip of the plain bytes written to `<basename>.log.gz.tmp`, atomically renamed to `<basename>.log.gz`, then the plain file is removed); rules out keeping both plain and gzip and rules out deleting plain at the cold boundary without compression.
- Cold-to-gone deletes eligible `.log.gz` only; plain `.log` files below the hot boundary and non-eligible logs are never deleted or compressed — rules out deleting plain logs at `coldDays`.
- Non-terminal runs and terminal rows with null or non-finite `finishedAt` stay plain and untouched at every tier — rules out compressing or deleting live or unsettled runs.
- Invalid `retention.sessions` values and the distinct top-level non-object config throw path keep skipping this slice only with the existing stderr shapes — rules out new failure modes or slice-wide aborts.
- A plain `.log` coexisting with its `.log.gz` (crash between rename and unlink) is resolved by regenerating the `.log.gz` from the plain log via the same temp-then-rename path, then removing the plain file; stray `.log.gz.tmp` files are removed — rules out trusting a possibly truncated gzip or leaving both forms.
- No code reads session-log contents back (the session-log writer and write-loop call sites only write), so `.log.gz` affects no code reader; operators read cold logs with standard gzip tools — rules out adding gzip-aware readers.
- A second cleanup pass with the same clock and store is a no-op when no new aging occurred — rules out double-gzip or double-delete failures on unchanged files.
- Deferred to first consumer: exact apply-mode stdout line wording beyond tier verbs and counts — pin when operator docs need a frozen apply contract separate from dry-run.

## Task checklist

- [x] Extend session-log discovery in `v2/src/commands/cleanup.ts` to plan hot-to-cold compressions and cold-to-gone deletions across flat and month-shard paths, driven by `readRetentionSessions` `hotDays` and `coldDays`.
- [x] Implement apply: gzip eligible plain logs at hot, delete eligible `.log.gz` at cold; preserve invalid-config and load-error refusal behavior.
- [x] Replace the aggregate expired-log dry-run/apply summary with per-tier counts plus plain source bytes for hot-to-cold and on-disk gzip bytes for cold-to-gone; dry-run must not mutate files.
- [x] Rewrite and extend `describe("cleanup: session log retention")` in `v2/src/commands/cleanup.test.ts` for tier behavior, shard + flat layouts, idempotence, and preserved invalid-config / excluded-path / zero-run-row cases.

## Acceptance criteria

- [x] `v2/src/commands/cleanup.test.ts` test `tiered session log retention recovers interrupted compression` pins that a plain `.log` beside an existing `.log.gz` (and a stray `.log.gz.tmp`) ends as a single valid `.log.gz` decompressing to the plain bytes, with no plain file or temp left; fails against a reaper that skips or double-counts the pair.
- [x] `v2/src/commands/cleanup.test.ts` test `tiered session log retention hot cold gone` fails against the single-window reaper and pins `finishedAt` terminal aging, mtime orphan aging, hot plain preservation, hot-to-cold gzip, cold-to-gone deletion, non-terminal preservation, legacy flat and month-shard discovery, and rerun idempotence with injected clock, state store, and `JARVIS_HOME`.
- [x] `v2/src/commands/cleanup.test.ts` test `tiered session log retention dry-run per-tier summary` fails against the aggregate expired-log summary and pins per-tier counts, plain source bytes for hot-to-cold, gzip-file bytes for cold-to-gone, and no filesystem mutation.
- [x] `v2/src/commands/cleanup.test.ts` tests `session retention config default and invalid values refuse reaping`, `session retention skips reaping when top-level machine config is not an object`, and `zero run rows suppress the orphan mtime fallback` stay green.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — subspec 01 owns operator and baseline doc alignment.
