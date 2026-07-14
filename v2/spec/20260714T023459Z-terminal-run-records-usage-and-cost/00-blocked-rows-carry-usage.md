# Blocked and blocker-rejected rows carry usage and cost

A patch iteration that returns an `ok` agent result and then detects a `## Blocker` writes a
`runs.jsonl` row with `kind: "blocked"`, `exit_reason: "blocker-detected"` and nothing else — no
`usage`, no `cost_usd`, no `cost_source`, no `last_output_age_ms`, no agent `warnings`
(`v1/src/modes/patch/iteration.ts`, the `writeTelemetry` call in the blocker-stands branch). The
same omission applies to the two `blocker-rejected` rows on the same result
(`exit_reason: "base-ref-green"`, `exit_reason: "snapshot-churn"`). The result event carrying the
usage is already in hand — `usageCost` is computed at the top of the `result.kind === "ok"` branch
and spread into the completion, progress, and no-progress rows only.

Blocked is the encouraged outcome for an agent that cannot proceed honestly, so the cost sheets
systematically under-report the runs where an agent worked longest.

## Decisions

- Enrich the existing rows in place; do not add a second usage-bearing row. Rules out emitting a
  separate `run_terminal` cost row, which `run-summary.ts` excludes from totals by design.
- The `blocked` row stays an invocation row (no `record_role`), so its usage counts in run-summary
  totals exactly once.
- `blocker-rejected` rows (`base-ref-green`, `snapshot-churn`) get the same enrichment: the spend
  happened on the same invocation whether or not the blocker survived.
- Non-`ok` results (`quota`, `model_config`, `error`) are untouched: those results carry no usage
  fields, so there is nothing to record.

## Acceptance criteria

- [ ] A patch iteration whose agent result carries usage and ends `blocked` / `blocker-detected`
      writes a `runs.jsonl` row carrying `usage`, `usage_source`, `cost_usd`, `cost_source`, and
      `last_output_age_ms`, on the same `namespace` the completion path uses.
- [ ] Agent `warnings` from that result appear on the blocked row, as they do on `criteria-progress`.
- [ ] `blocker-rejected` rows (`base-ref-green` and `snapshot-churn`) carry the same usage/cost
      fields.
- [ ] The blocked row is counted once in run-summary cost totals (it is not a `run_terminal` row and
      is not duplicated by one).
- [ ] Existing patch telemetry tests (`v1/test/run.test.ts`, `v1/test/run-cost-claude.test.ts`) stay
      green.

## Documentation updates

- `v1/docs/operator-runbook.md` § Cost reporting standard — remove the "A `blocked` v1 run records
  no cost at all" caveat.
- `v2/docs/v1-behaviors.md` — record that patch `blocked` / `blocker-rejected` rows carry
  usage/cost/`last_output_age_ms` whenever the agent produced a result event.
