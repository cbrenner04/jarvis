# A blocked run's agent work is unattributable

A patch run that ends `blocked` writes `runs.jsonl` rows carrying **no `cost_usd` and no
`usage`** — the agent's work is invisible to every cost sheet.

## Problem

Observed 2026-07-13. `jarvis1 run v2/spec/20260713T193047Z-blocked-run-retains-worktree-and-branch/index.md`
ran claude for **13m 35s**, produced a real diff (a regression test, a CLI change, docs) and a
`## Blocker`, and exited 7. Its two `runs.jsonl` records:

```json
{"ts":"…","namespace":"jarvis:20260713T193047Z-…","mode":"patch","agent":"claude",
 "iteration":1,"duration_ms":813582,"kind":"blocked","exit_reason":"blocker-detected",
 "configured_model":"claude-sonnet-5"}
```

No `cost_usd`. No `usage`. No `last_output_age_ms`. The work landed as PR #1508, so this is not a
run that did nothing — it is a run whose spend cannot be reported.

Blocked is a *normal, encouraged* outcome (the rules tell agents to block rather than guess), so
the cost sheets systematically under-report exactly the runs where an agent worked hard and
stopped honestly.

## Decisions

- **A terminal run records its agent usage and cost regardless of exit reason.** Cost is a
  property of the invocation, not of the outcome. Rules out the current shape, where the
  usage-bearing record is only written on the completion path.
- Same for `last_output_age_ms` — a blocked run measured output; record what it measured.
- The row joins on the same identity the sheets already use (`namespace`, `run_start_ts`).

## Prerequisites

- None.

## Out of scope

- v2 telemetry, which records per-invocation cost independently of run outcome (#1509).

## Documentation updates

- `v1/docs/operator-runbook.md` § Cost reporting standard — blocked-run rows are currently blank;
  delete that caveat when this ships.
