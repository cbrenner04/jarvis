---
name: intake-nudge-on-cli-run-completion
---

# Nudge the intake link once when a run/prompt completes

## Problem

Even with the intake on README/AGENTS, an outside operator working in the terminal has no
in-context reminder that harness friction has a submit path. The CLI should surface the link
once, where the operator already is — without adding per-iteration or help-footer noise.

## Wanted behavior

- When a `run`/`prompt` invocation completes, the end-of-run summary surfaces the canonical
  intake URL once.
- The nudge appears only at completion — not in the `help` footer, not per iteration.
- It uses the same single canonical `issues/new/choose` URL as the other surfaces.

## Decisions

- End-of-run summary is the only placement — lowest-noise spot an outside operator actually sees
  in context (rules out help footer and per-iteration nudges).

## Out of scope

- Changing the intake mechanism — only its discoverability.
- README / AGENTS / issue-chooser pointers (separate behavior).

## Prerequisites

- The GitHub harness-suggestion issue template and intake channel exist and the canonical issues/new/choose URL resolves.
- The CLI emits an end-of-run summary on run/prompt completion.

## Blocker

Prerequisite unconfirmed: **prompt mode emits no end-of-run summary.** Only patch (`run`) and `plan` modes call a summary builder:

- `v1/src/modes/patch/iteration.ts:277` → `runSummary(...)`
- `v1/src/modes/plan/run.ts:1483` → `planSummary(...)`

`v1/src/modes/prompt/run.ts` only echoes the agent's stdout (`opts.io.stdout(agentOutput)`, line 380); there is no summary surface to attach a one-time nudge to. The intent's wanted behavior names both `run` and `prompt`, so the nudge has nowhere to land on `prompt` completion.

Resolve before drafting — pick one:

1. **Descope to summary-bearing modes.** Attach the nudge to the existing `run` (and optionally `plan`) summary only; drop `prompt` from this intent. Lowest-cost, matches existing surfaces.
2. **Add a prompt-mode end-of-run summary first** as a separate behavior/intent, then nudge across all three. Larger; the missing summary is its own behavior, not part of "discoverability."

Note: the canonical URL is currently doc-only (hardcoded in README.md / AGENTS.md / v1/docs/operator-runbook.md); no shared code constant exists. If drafting proceeds, decide whether to introduce one shared constant or inline the string — flag for the implementer.
