# Cleanup preserves closed telemetry archives

## Problem

Monthly roll adds long-lived `telemetry/<YYYY-MM>.jsonl.gz` artifacts under `JARVIS_HOME`. Session-log retention and future home-directory reapers must never delete them.

## Decisions

- Closed telemetry archives are only `join(jarvisRoot, "telemetry", "<YYYY-MM>.jsonl.gz")` with `<YYYY-MM>` matching `^\d{4}-\d{2}$` — rules out treating the live `telemetry.jsonl` current file as an archive and rules out deleting archives because they look like session logs.
- Any cleanup slice that could delete or compress files under `jarvisRoot` must skip that `telemetry/` archive directory explicitly — rules out relying on today's session-log scan paths alone when new reapers broaden discovery.
- Tiered session-log retention behavior from `discoverExpiredSessionLogs` stays unchanged for real session logs — rules out folding telemetry archives into hot/cold/gone session tiers.
- On main, session-log apply never discovers `jarvisRoot/telemetry/*.jsonl.gz`; a pre-fix failing proof must exercise the preservation hook against constructible delete/compress candidates, not assert survival through apply alone.

## Task checklist

- [ ] Add a closed-telemetry archive preservation guard in `v2/src/commands/cleanup.ts` on the `runCleanupCommand` session-log retention apply path (same block as `ctx.sessionLogPlan` hot-to-cold / cold-to-gone); export the predicate for unit tests.
- [ ] Extend `v2/src/commands/cleanup.test.ts` with a guard unit test using constructible archive paths as delete/compress candidates and an apply test via `runCleanupCommand` (same helper as `tiered session log retention hot cold gone`) that ages session logs while old `telemetry/<YYYY-MM>.jsonl.gz` files remain on disk.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` test `closed telemetry archive preservation guard` fails against missing export/hook on main (reachable: apply never lists `jarvisRoot/telemetry/*.jsonl.gz` today) and pins the exported predicate rejects `join(jarvisRoot, "telemetry", "<YYYY-MM>.jsonl.gz")` when treated as a session-log delete or compress candidate.
- [ ] `v2/src/commands/cleanup.test.ts` test `cleanup preserves closed telemetry archives through session log retention apply` exercises `runCleanupCommand` with injected clock, retention config, and `JARVIS_HOME`, runs hot/cold session-log deletion, and pins aged `telemetry/<YYYY-MM>.jsonl.gz` files survive confirm apply once the guard is wired on that path.
- [ ] `v2/src/commands/cleanup.test.ts` tests `tiered session log retention hot cold gone` and `session retention guard preserves excluded paths` stay green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` and `bun run test:integration:v2` pass. (Manual)

## Documentation updates

None — subspec 02 owns operator and baseline doc alignment.
