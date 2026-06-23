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
  The `ok` `result` is currently loop-scoped (run.ts:279); hoist it (or the
  extracted fields) out of the agent loop so the success termini can read it.
  Rules out: hand-rolling usage extraction or shipping the summary without cost
  data.
- Telemetry must be appended **before** `promptSummary` reads it, since the
  builder reads the JSONL file. Write the enriched row **at each success
  terminus** (no-diff `return 0` ~381 and post-PR `return 0` ~443), ahead of the
  summary emit. Guard the `finally` write (run.ts:~456) with a write-once flag
  so it fires only when no terminus already wrote — failure paths (`return 1`)
  still emit exactly one row through `finally`. Rules out: leaving the write in
  `finally` (summary would render `(no telemetry records found)`), and leaving a
  duplicate row (would inflate the attempt count and cost table).
- Capture diff-path duration **after** `gh pr create` at the terminus,
  preserving today's `Date.now() - runStartedMs` wall-clock semantics (currently
  computed in `finally` ~452, after commit/push/PR). Rules out: capturing
  duration before PR creation, which would understate `duration:` by the
  git/push/gh time.
- Error/quota/timeout and commit/push/PR-failure paths keep their existing
  telemetry write and exit codes unchanged — summary is emitted only on the
  two success termini (exit 0). Rules out: emitting a summary on failure exits.
- Capture `gh pr create` stdout (it prints the PR URL) and surface the URL in
  the outcome line. The call passes `stdio: "pipe"` but no `encoding`
  (run.ts:~435), so its return is not a string today; add `encoding: "utf8"` and
  trim to obtain the URL. Rules out: opening the PR without telling the operator
  where it landed.
- No-diff path stdout order: agent output first (`opts.io.stdout(agentOutput)`
  ~380), then the summary block + outcome line. Rules out: interleaving that
  buries the agent response under the summary.
- Outcome line distinguishes the two paths: a no-diff line (no changes made) and
  a PR-opened line including the PR URL. Emit the outcome line with the summary
  block on stdout. Deferred to first consumer: exact outcome wording — pin at
  implementation; criteria below grade the distinction and URL presence, not the
  phrasing.
- Summary + outcome are written to stdout (operator-facing), matching
  patch/plan summary emission. Rules out: stderr, where it would mix with the
  per-attempt fallback diagnostics.

## Task checklist

- Hoist the loop-scoped `ok` `result` (run.ts:279) out of the loop and capture
  `extractUsageAndCost(...)` fields.
- Restructure telemetry emission so the enriched row is written once at each
  success terminus before the summary renders; add the write-once guard on the
  `finally` block; keep the failure-path write.
- Add `encoding: "utf8"` to the `gh pr create` call and trim its stdout to get
  the PR URL.
- Capture diff-path duration after `gh pr create`.
- Emit `promptSummary({...})` plus the outcome line on both success paths
  (no-diff: after the agent-output stdout).
- Cover both paths in `v1/test/modes/prompt/run.test.ts`.

## Acceptance criteria

- [x] On no-diff success the prompt telemetry row carries
  `usage`/`usage_source`/`cost_usd`/`cost_source` derived from the agent result
  (not agent/model/duration only).
- [x] On no-diff success stdout emits the agent output first, then a
  `─── prompt summary ───` block (agent + model, tokens/cost, duration) and an
  outcome line stating no changes were made; exit code is 0.
- [x] On diff success stdout contains the prompt summary block and an outcome
  line that includes the created PR URL; exit code is 0.
- [x] Exactly one prompt telemetry row is written per successful run (no
  duplicate from the `finally` block).
- [x] No summary is emitted and exit codes are unchanged on the
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
