---
name: prompt-mode-end-of-run-summary
---

# `prompt` mode should emit an end-of-run summary

## Problem

`jarvis prompt` can complete successfully and leave the operator with no idea what happened.
Unlike `run` (patch) and `plan` — which each emit a structured end-of-run summary
(`runSummary` / `planSummary` in `v1/src/run-summary.ts`: agent/model, tokens, cost, duration,
exit reason) — `prompt` mode just ends. Its two success paths return with no summary:

- **No-diff** (`v1/src/modes/prompt/run.ts` ~line 380): echoes the agent's stdout and returns 0.
- **Diff**: commits, pushes, opens a draft PR, returns 0 — printing little beyond the `gh`
  output.

So a successful `prompt` leaves the operator asking "what happened?" — which agent/model ran,
what it cost, how long it took, and (diff case) what PR it opened (or, no-diff case, that it
made no changes).

## Direction

Give `prompt` mode an end-of-run summary on its success paths, consistent with `run`/`plan`.
Reuse the shared summary surface (`v1/src/run-summary.ts`) rather than a bespoke print — add a
`promptSummary` (or extend the shared builder) covering at least: agent + model, token/cost,
duration, outcome (no-diff vs PR-opened, with the PR URL when one was created). Keep error-exit
paths (quota/agent-error/timeout, commit/push/PR failures) as they are; this is about the
**success** terminus.

## Open questions (for plan to decide)

- One shared summary builder parameterized per mode, or a `prompt`-specific `promptSummary`
  alongside `runSummary`/`planSummary`?
- What fields belong in the prompt summary (cost/tokens are available; outcome line shape for
  no-diff vs PR-opened)?
- Does the no-diff path keep echoing the full agent stdout *and* add a summary, or does the
  summary replace/augment it?

## Out of scope

- `run`/`plan` summaries — unchanged.
- The intake-link nudge (separate intent [[intake-nudge-on-cli-run-completion]]); once this
  summary exists, that nudge can extend onto it.

## References

- `v1/src/modes/prompt/run.ts` — the two success termini (no-diff echo ~line 380; diff →
  commit/push/PR).
- `v1/src/run-summary.ts` — `runSummary` / `planSummary` to mirror or extend.
- `v1/src/modes/patch/iteration.ts:277`, `v1/src/modes/plan/run.ts:1483` — how the other modes
  call the summary builder.
