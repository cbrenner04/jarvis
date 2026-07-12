---
name: retire-claude-pool-contention-folklore
---

# Retire the Claude pool-contention warning and the guidance built on it

## Problem

`v1/src/modes/patch/pool-contention.ts` warns that the selected patch primary
"shares Claude pool with a live Jarvis operator/orchestration session". It is wired
into `v1/src/modes/patch/run.ts` and it fires on process existence — any `claude`
process with a `jarvis` ancestor — which is true in essentially every operator
session. It measures no contention.

Two operator-runbook entries rest on it, and both are now known to be
misattributions of the claude output-observation bug: "claude-haiku stalls to a
zero-output iteration-timeout" (2026-07-11) and "claude-sonnet-5 is too slow to be
patch primary" (2026-07-12). The contention theory is contradicted by the same
session: two concurrent `claude-opus-4-8` *plan* runs completed fine on the same
pool while the claude *patch* run "stalled". Zero output was never a symptom of
starvation; it was the absence of a measurement. The runbook's "prefer cursor/codex
when the operator is a Claude session" advice is therefore steering operators away
from claude for a bug that no longer exists.

## Decisions

- Remove the pool-contention warning rather than refine it — an existence probe cannot
  measure contention, and a warning that always fires teaches operators nothing.
  Ruling out: keeping it behind a heuristic threshold, which re-entrenches an unproven
  causal story.
- Correct, don't merely delete, the runbook entries: state what actually happened, so
  the misdiagnosis isn't rediscovered.

## Out of scope

- Changing the default `agentOrder`.

## Acceptance criteria (behavioral)

- A patch run whose primary is a claude model, launched from a live Jarvis claude
  operator session, emits no pool-contention warning.
- The operator runbook no longer advises preferring cursor/codex on the basis of
  Claude-pool contention, and the claude-haiku "zero-output stall" entry is corrected
  to name the output-observation bug as the cause.

## Documentation updates

- `v1/docs/operator-runbook.md` — correct the claude-haiku zero-output-stall entry and
  the "prefer cursor when the operator is a Claude session" guidance; remove the shared
  model pool contention section.
- `v1/docs/run-loop.md` — remove the mirrored pool-contention warning description.
- `v2/docs/v1-behaviors.md`.

## Prerequisites

- Claude patch runs populate `last_output_age_ms` (the fix that invalidates the contention explanation must land first).
