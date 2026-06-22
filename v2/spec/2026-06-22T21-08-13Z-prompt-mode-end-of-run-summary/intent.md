---
name: prompt-mode-end-of-run-summary
---

# `prompt` mode emits an end-of-run summary on success

## Problem

A successful `jarvis prompt` ends with no structured summary, unlike `run` and
`plan` (`runSummary` / `planSummary` in `v1/src/run-summary.ts`). Both prompt
success termini are silent on agent/model, tokens, cost, and duration:

- no-diff (`v1/src/modes/prompt/run.ts` ~380): echoes agent stdout, returns 0.
- diff: commits, pushes, opens a draft PR, returns 0; prints little past `gh`.

So a successful prompt leaves the operator asking what agent/model ran, what it
cost, how long it took, and which PR opened (or that no changes were made).

## Direction

On both prompt success paths, emit an end-of-run summary consistent with
`run`/`plan`, reusing the shared surface in `v1/src/run-summary.ts` (add a
`promptSummary` or parameterize the shared builder). Cover at least: agent +
model, tokens/cost, duration, and an outcome line distinguishing no-diff from
PR-opened (include the PR URL when one was created). Leave error-exit paths
(quota/agent-error/timeout, commit/push/PR failures) unchanged — this is the
success terminus only.

Note for plan: prompt mode currently writes its telemetry line in the `finally`
block after the success-path `return`, so the summary's data source and emit
point need sequencing.

## Prerequisites

- The shared run-summary builder reads per-run telemetry to render agent/model, tokens, cost, and duration.
- `prompt` mode records a per-run telemetry line carrying agent, configured model, duration, and cost/usage.

## Blocker

Prerequisite "`prompt` mode records a per-run telemetry line carrying agent,
configured model, duration, **and cost/usage**" is not met for the cost/usage
clause.

`prompt` mode's only telemetry write (`v1/src/modes/prompt/run.ts:456`, in the
`finally` block) records `agent`, `configured_model`, `duration_ms`, `kind`,
`exit_reason`, `mode: "prompt"` — but no `usage`, `usage_source`, `cost_usd`, or
`cost_source`. There is no `extractUsageAndCost` call anywhere under
`v1/src/modes/prompt/` (patch mode derives these via
`extractUsageAndCost(...)` in `iteration.ts` before enriching its line).

The shared builder renders tokens/cost solely by aggregating `usage` /
`cost_usd` / `cost_source` / `usage_source` off telemetry records
(`run-summary.ts` `renderSummaryFromRecords`). With those fields absent from the
prompt line, a summary reusing the shared surface cannot show the tokens/cost
the Direction requires ("Cover at least: agent + model, tokens/cost, duration").
(Separately, the prompt line's `mode: "prompt"` is not matched by
`recordMatchesMode`, which only accepts `patch`/`plan` — a builder concern, not
the blocker.)

Resolve before drafting, by either:

1. Build the cost/usage telemetry-enrichment prerequisite first (have prompt
   mode call `extractUsageAndCost` and write `usage`/`usage_source`/`cost_usd`/
   `cost_source` on its telemetry line), as its own intent/spec; then re-run
   plan here. Or
2. Revise this intent to fold telemetry enrichment into its scope and drop the
   "cost/usage" clause from Prerequisites (it would then be work, not a
   precondition).
