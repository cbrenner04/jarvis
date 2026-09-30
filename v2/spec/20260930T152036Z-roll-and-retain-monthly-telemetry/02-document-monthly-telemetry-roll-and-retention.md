# Document monthly telemetry roll and retention

## Problem

Operators and v1-parity review lack runbook steps for gzip archives and a baseline entry for monthly roll plus indefinite closed-month retention.

## Decisions

- Operator guidance lives in `v2/docs/operator-runbook.md` § Reading telemetry — rules out a duplicate full layout spec outside `telemetry-capture.md`.
- v1 parity records forward-looking v2 behavior in `v2/docs/v1-behaviors.md` — rules out implying v1 ever rolled telemetry monthly.

## Task checklist

- [ ] Update `v2/docs/operator-runbook.md` § Reading telemetry with how to read the current `telemetry.jsonl`, list and decompress `telemetry/<YYYY-MM>.jsonl.gz` with standard gzip tooling, and that closed months are retained indefinitely.
- [ ] Update `v2/docs/operator-runbook.md` § Workflow ends "complete" but produced no PR (`~/.jarvis/telemetry.jsonl` per-role rows bullet) and § Known gotchas (`quota_exhausted` `resetsAt` python snippet) so queries spanning a month boundary also read `telemetry/<YYYY-MM>.jsonl.gz`.
- [ ] Update `v2/docs/operator-practices.md` § cost sources ("Which file is authoritative") so cost lives in `telemetry.jsonl` plus closed `telemetry/<YYYY-MM>.jsonl.gz` archives, and a `ts` window crossing a month reads the prior archive too.
- [ ] Add a `v2/docs/v1-behaviors.md` entry for monthly UTC telemetry roll, `telemetry/` gzip archives, and indefinite closed-month retention (sources: `telemetry-sink.ts`, `cleanup.ts`).

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` documents current-file vs `telemetry/<YYYY-MM>.jsonl.gz` paths under `JARVIS_HOME` and gives a minimal decompress/read example using standard gzip tooling.
- [x] `v2/docs/operator-runbook.md` per-role telemetry bullet and `resetsAt` snippet, and `v2/docs/operator-practices.md` cost-source paragraph, each name `telemetry/<YYYY-MM>.jsonl.gz` for windows crossing a month boundary.
- [x] `v2/docs/v1-behaviors.md` contains a **[v2 additive]** or **[v2 behavior change]** bullet for monthly telemetry rolling and indefinite closed-archive retention with source paths.
- [x] `bun run typecheck` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — per task checklist.
- `v2/docs/operator-practices.md` — per task checklist.
- `v2/docs/v1-behaviors.md` — per task checklist.
