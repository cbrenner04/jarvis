---
name: terminal-run-records-usage-and-cost
---

# A terminal patch run records usage and cost regardless of exit reason

Today only the completion path writes a usage-bearing `runs.jsonl` record. A run that ends
`blocked` (exit 7, `exit_reason: blocker-detected`) writes rows with no `cost_usd`, no `usage`,
and no `last_output_age_ms` — so real agent spend on a normal, encouraged outcome is invisible to
every cost sheet.

Behavior: a terminal patch run records the agent's usage, cost, and `last_output_age_ms` on the
same identity the sheets already join on (`namespace`, `run_start_ts`) whenever the agent produced
a result event, regardless of `kind`/`exit_reason`. Cost is a property of the invocation, not the
outcome — this does not extend to terminal states with no result event (e.g. quota-exhausted
before any output, preflight failures), where there is no usage to record.

Out of scope: v2 telemetry (#1509).

## Documentation updates

- `v1/docs/operator-runbook.md` § Cost reporting standard — drop the caveat that blocked-run rows
  are blank.
- `v2/docs/v1-behaviors.md` — record the updated `runs.jsonl` terminal-record behavior (usage/cost
  populated whenever a result event exists, not only on completion).

## Prerequisites
