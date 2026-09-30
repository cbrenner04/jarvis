# Cleanup preserves closed telemetry archives

## Problem

Monthly roll adds long-lived `telemetry/<YYYY-MM>.jsonl.gz` artifacts under `JARVIS_HOME`. Nothing pins that `jarvis cleanup` leaves them alone.

## Decisions

- Regression guard only: session-log discovery scans `sessionsDir` (default `join(jarvisRoot, "sessions")`), so `jarvisRoot/telemetry/` is never a candidate on main — rules out an exported preservation predicate or apply-path hook for reapers that do not exist.
- Tiered session-log retention behavior stays unchanged — rules out folding telemetry archives into hot/cold/gone tiers.

## Task checklist

- [ ] Extend `v2/src/commands/cleanup.test.ts` with one apply test via `runCleanupCommand` (same helper as `tiered session log retention hot cold gone`) that ages session logs past hot/cold cutoffs while old `telemetry/<YYYY-MM>.jsonl.gz` files sit under `JARVIS_HOME`.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` test `cleanup preserves closed telemetry archives through session log retention apply` (regression guard; passes on main) exercises `runCleanupCommand` with injected clock, retention config, and `JARVIS_HOME`, applies hot/cold session-log retention, and pins aged `telemetry/<YYYY-MM>.jsonl.gz` files survive byte-identical.
- [ ] `v2/src/commands/cleanup.test.ts` tests `tiered session log retention hot cold gone` and `session retention guard preserves excluded paths` stay green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

None — subspec 02 owns operator and baseline doc alignment.
