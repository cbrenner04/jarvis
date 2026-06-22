---
name: intake-nudge-on-cli-run-completion
---

# Nudge the intake link once on run/plan completion summaries

## Problem

Even with the intake on README/AGENTS, an outside operator working in the terminal has no
in-context reminder that harness friction has a submit path. The CLI should surface the link
once, where the operator already is — without adding per-iteration or help-footer noise.

## Wanted behavior

- When a `run` or `plan` invocation completes, its end-of-run summary surfaces the canonical
  intake URL once.
- The nudge appears only at completion — not in the `help` footer, not per iteration.
- It uses the same single canonical `issues/new/choose` URL as the other surfaces, sourced from a
  shared code constant (the URL is currently hardcoded in README/AGENTS/runbook; introduce one
  constant for the code path so the nudge and any future code use stay in sync).

## Decisions

- **End-of-run summary is the only placement** — lowest-noise spot an outside operator actually
  sees in context (rules out help footer and per-iteration nudges).
- **Scope to the `run` and `plan` summaries; skip `prompt`** (operator decision, blocker resolved).
  `run` (`runSummary`) and `plan` (`planSummary`) each have a single clean summary surface in
  `v1/src/run-summary.ts`. `prompt` mode has **no** summary surface — it ends by either echoing the
  agent's stdout (no-diff) or opening a draft PR (diff), across multiple exit points — so attaching
  a nudge there is over-build for this intent. A prompt-mode summary is its own separate work
  ([[prompt-mode-end-of-run-summary]]); once it lands, the nudge can extend there too.

## Out of scope

- `prompt`-mode completion nudge / building a prompt summary surface — separate intent
  [[prompt-mode-end-of-run-summary]].
- Changing the intake mechanism — only its discoverability.
- README / AGENTS / issue-chooser pointers (separate behavior, shipped).

## Prerequisites

- The GitHub harness-suggestion issue template and intake channel exist and the canonical
  `issues/new/choose` URL resolves.
- `run` and `plan` modes emit an end-of-run summary (`runSummary` / `planSummary` in
  `v1/src/run-summary.ts`) — confirmed.
