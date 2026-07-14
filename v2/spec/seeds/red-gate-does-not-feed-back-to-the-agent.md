# A red ready gate ends the run instead of handing the failure back to the agent

When a v2 implement run's ready gate goes red, the run stops at `ready_finalize_failed` and the
operator hand-fixes the tree. The agent that wrote the code is never told what the gate said,
even though it is the cheapest possible repair and the failure is usually mechanical.

## Problem

Observed 2026-07-14, run on spec `20260714T023457Z-v2-ready-gate-runs-full-tier` (PR #1539).
The run's own change — pinning the gate to the `full` tier — worked: the gate caught a biome
format error in the two test files the agent had just written, and correctly refused to flip the
PR to ready. CI then failed on the identical error.

The repair was `bun run fix` — two files, zero judgment — done by the operator by hand. Nothing
about that requires a human, and nothing about it requires a new run: the write loop had the
worktree open, the agent in context, and the gate's stderr in hand.

The same shape will now recur on **every** format/lint slip, and the full tier makes those
strictly more likely to be caught (which is the point). Without feedback, the fix that makes the
gate honest also makes the operator the gate's repair loop.

## Decisions

- **A red gate is a boundary the agent gets to respond to, not a terminal state.** On a gate
  failure the run re-invokes the agent with the gate's command, exit code, and output, and
  re-gates. Rules out today's "record `ready_finalize_failed` and stop."
- **Bounded.** A gate-repair iteration is capped (one or two attempts); a still-red gate after
  the cap is terminal, exactly as today, and the run does not flip the PR to ready.
- Repair iterations are ordinary write-loop iterations — they consume the iteration budget, are
  visible in the run log, and their agent invocations are recorded in telemetry. No hidden work.
- Do not narrow this to formatting. The mechanism is "the gate's output is agent-visible"; which
  failures it can repair is the agent's problem, not the harness's.

## Prerequisites

- `v2-ready-gate-runs-full-tier` (shipped, #1539) — without the full tier the gate rarely goes
  red, so the feedback path would be untested.

## Out of scope

- The gate's tier or contents.
- v1 patch mode's completion gate.

## Documentation updates

- `v2/docs/write-behavior.md` — the gate boundary and its repair iterations.
- `v2/docs/operator-runbook.md` § Gate trust — drop "hand-fix the tree and push" once this ships.
