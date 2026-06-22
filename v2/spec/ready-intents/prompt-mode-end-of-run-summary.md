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

This intent includes the telemetry enrichment the summary depends on (folded in
after a plan-time blocker found the data isn't there yet — in-scope work, not a
precondition):

- **Enrich the prompt telemetry line** to carry the fields the shared builder
  renders: have `prompt` mode call `extractUsageAndCost` (as `patch`/`plan` do) and
  write `usage` / `usage_source` / `cost_usd` / `cost_source` alongside the existing
  agent / model / duration on its telemetry record.
- **Make the builder accept prompt records**: `recordMatchesMode` currently matches
  only `patch`/`plan`; extend it to accept `mode: "prompt"` so a `promptSummary` can
  render from the prompt line.

Note for plan: prompt mode currently writes its telemetry line in the `finally`
block after the success-path `return`, so the summary's data source and emit point
need sequencing (the summary must read the enriched values).

## Out of scope

- `run` / `plan` summaries — unchanged.
- Error-exit paths (quota/agent-error/timeout, commit/push/PR failures) — unchanged.
