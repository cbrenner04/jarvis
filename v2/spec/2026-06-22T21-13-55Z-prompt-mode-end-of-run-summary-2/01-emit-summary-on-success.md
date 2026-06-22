# Enrich prompt telemetry and emit summary on both success paths

## Problem

`v1/src/modes/prompt/run.ts` ends both success paths silently:

- no-diff (~380): echoes agent stdout, returns 0.
- diff: commits, pushes, opens a draft PR, returns 0; prints little past `gh`.

Its telemetry line (written in the `finally` after the success `return`) carries
only agent/model/duration — no `usage`/`cost_usd`/`cost_source`, so even with
`promptSummary` (subspec `00`) there is nothing to render. This subspec enriches
the telemetry line and emits the summary on both success termini.

## Decisions

- Call `extractUsageAndCost(result, agent.name, configuredModel)` on the
  successful `ok` result (as `patch`/`plan` do) and write its
  `usage`/`usage_source`/`cost_usd`/`cost_source` onto the telemetry record.
  Rules out: hand-rolling usage extraction or shipping the summary without cost
  data.
- Telemetry must be appended **before** `promptSummary` reads it, since the
  builder reads the JSONL file. Move the success-path telemetry write ahead of
  the summary emit and ensure the `finally` block does not double-write the same
  row. Rules out: leaving the write in `finally` (summary would render
  `(no telemetry records found)`), and leaving a duplicate row (would inflate
  the attempt count and cost table).
- Error/quota/timeout and commit/push/PR-failure paths keep their existing
  telemetry write and exit codes unchanged — summary is emitted only on the
  two success termini (exit 0). Rules out: emitting a summary on failure exits.
- Capture `gh pr create` stdout (it prints the PR URL) and surface the URL in
  the outcome line. Rules out: opening the PR without telling the operator where
  it landed.
- Outcome line distinguishes the two paths: a no-diff line (no changes made) and
  a PR-opened line including the PR URL. Emit the outcome line with the summary
  block on stdout. Deferred to first consumer: exact outcome wording — pin at
  implementation; criteria below grade the distinction and URL presence, not the
  phrasing.
- Summary + outcome are written to stdout (operator-facing), matching
  patch/plan summary emission. Rules out: stderr, where it would mix with the
  per-attempt fallback diagnostics.

## Task checklist

- On the successful `ok` branch, capture `extractUsageAndCost(...)` fields.
- Restructure telemetry emission so the enriched row is written once, before the
  summary is rendered, on both success paths; keep the failure-path write.
- Capture `gh pr create` stdout to obtain the PR URL.
- Emit `promptSummary({...})` plus the outcome line on both success paths.
- Cover both paths in `v1/test/modes/prompt/run.test.ts`.

## Acceptance criteria

- [ ] On no-diff success the prompt telemetry row carries
  `usage`/`usage_source`/`cost_usd`/`cost_source` derived from the agent result
  (not agent/model/duration only).
- [ ] On no-diff success stdout contains a `─── prompt summary ───` block (agent
  + model, tokens/cost, duration) and an outcome line stating no changes were
  made; exit code is 0.
- [ ] On diff success stdout contains the prompt summary block and an outcome
  line that includes the created PR URL; exit code is 0.
- [ ] Exactly one prompt telemetry row is written per successful run (no
  duplicate from the `finally` block).
- [ ] No summary is emitted and exit codes are unchanged on the
  quota-exhausted, agent-failure, timeout, and commit/push/PR-failure paths
  (existing `v1/test/modes/prompt/run.test.ts` error/quota/timeout tests stay
  green).

## Documentation updates

- `v1/docs/specless-prompt.md`: document that both success outcomes (no-diff,
  PR-opened) now emit an end-of-run summary, and that the PR-opened outcome line
  reports the PR URL.
- `v2/docs/v1-behaviors.md`: update the prompt-telemetry and diff/no-diff outcome
  entries — telemetry now carries usage/cost, and the success terminus emits a
  `promptSummary` with an outcome line (changes existing v1 behavior).
