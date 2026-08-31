# Wall and agent time per pipeline stage

Measured 2026-08-31. Companion to [20260831T050512Z-pipeline-agent-turns.md](./20260831T050512Z-pipeline-agent-turns.md): same population and stage cells, measuring minutes instead of turns.

## Method

- Same sources, filters, and cell classification as the turns note (jarvis project, completed workflows, telemetry era from 2026-07-12).
- **Wall** = first run `created_at` → last run end per workflow invocation, using `finished_at` with the run's latest `attempts.completed_at` as fallback (2,260 completed jarvis runs predate the `finished_at` column). Includes harness work: gates, commits, publication, and quota/pause stalls.
- **Agent** = summed subprocess `duration_ms` over every telemetry row for the workflow's runs, quota-fallback retries included.
- **Min is omitted as degenerate**: the per-cell floors (0.2-minute implements, 0.4-minute intents) are no-op/already-complete runs, not fast real work. p10 is the honest quick-run floor.

## Minutes per stage cell

| stage cell | cut | n | p10 | p50 | mean | p90 | max |
|---|---|---|---|---|---|---|---|
| intent / none | wall | 82 | 0.6 | 1.2 | 2.3 | 3.8 | 39.8 |
| | agent | | 0.6 | 1.2 | 2.2 | 3.8 | 33.0 |
| intent / light | wall | 178 | 2.1 | 3.7 | 4.4 | 7.2 | 21.2 |
| | agent | | 1.9 | 3.4 | 3.9 | 6.4 | 11.6 |
| plan / none | wall | 159 | 1.0 | 2.1 | 2.8 | 5.4 | 14.2 |
| | agent | | 1.0 | 2.1 | 2.7 | 5.4 | 14.2 |
| plan / debate | wall | 248 | 4.2 | 8.2 | 10.2 | 19.6 | 36.5 |
| | agent | | 4.0 | 8.1 | 10.0 | 19.2 | 36.0 |
| implement / none | wall | 120 | 4.4 | 10.6 | 18.5 | 36.5 | 259.4 |
| | agent | | 4.4 | 10.5 | 15.5 | 29.7 | 62.4 |
| implement / debate | wall | 149 | 11.0 | 26.4 | 42.6 | 76.1 | 403.7 |
| | agent | | 10.1 | 20.3 | 27.3 | 53.6 | 103.7 |

Wall ≈ agent everywhere except implement, where the gap (p50 +6, mean +15) is the harness tail: ready gate, completion publication, mutation verification, and quota/pause stalls. The wall maxes are stall-dominated — implement/debate's 403.7-minute worst case carries only 103.7 minutes of agent time. p50 is the planning number; means are tail-inflated.

Derived implement/light (no jarvis sample — same gap as the turns note): implement/none + the light-review delta observed on intent → wall ~5.9 p10 / ~13 p50 / ~21 mean / ~40 p90.

## Composed pipeline totals (approval wait excluded — human time)

| pipeline | cut | p10 | p50 | mean | p90 | max (worst cells summed) |
|---|---|---|---|---|---|---|
| fast | wall | ~8 | ~16 | ~26 | ~49 | ~316 |
| | agent | ~7 | ~16 | ~22 | ~42 | ~112 |
| full-review | wall | 17 | 38 | 57 | 103 | 461 |
| | agent | 16 | 32 | 41 | 79 | 151 |

Sums of means are exact; other summed quantiles are approximations, and worst cells never co-occurred in observed data. The full-review p10 floor is structural — a debate is 5 turns minimum on both plan and implement.

The 3 completed full-review pipelines ran 68.5 / 109.6 / 223.3 active minutes, with total spans only ~2 minutes longer — inter-stage dispatch overhead is negligible. All three sit in the distribution's upper half for the same spec-size reason as their turn counts, and the 3.3× spread between them is almost entirely the implement stage (52.0 / 96.9 / 191.6 minutes vs intent 3.6–4.3 and plan 8.4–28.0).

## Reproduction

`bun v2/docs/research/20260831T053634Z-pipeline-wall-time.ts` — same grouping as the turns script, emitting wall/agent minute distributions per cell plus per-stage active minutes for fully-succeeded pipelines. Reads the live telemetry file and a copy of the state DB; rerunning on a later dataset will drift from the snapshot above.
