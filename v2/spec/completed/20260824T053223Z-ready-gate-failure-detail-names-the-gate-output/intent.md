---
name: ready-gate-failure-detail-names-the-gate-output
---

# Ready-gate failure detail names the gate command and its output

## Prerequisites

- The v2 ready gate runs a project's configured `readyCommand` and falls back to `bun run ready`, reporting the resolved command on the gate error.
- A failed stage settles its `failureDetail` from the entry run's composed operator error (`composeRunOperatorError`, `v2/src/daemon/pipeline-stage-dispatch.ts`).

## Surface

Daemon operator-error composition and stage settlement.

## Problem

- A red gate settles the stage with `{ reason: "ready_gate_failed" }` and nothing else; the useful stderr (`Script not found "ready"`) survives only in the `intent_finalization` log event, so `run list`, `run wait`, and the TUI stage row show a cause-less failure.

## Behavior

- A stage failed by the ready gate carries a `failureDetail.message` naming the gate command and a bounded excerpt of its output.

## Decisions

- Carry the gate command and a bounded output excerpt on the terminal `loop_finished` record and map them onto the composed `ready_gate_failed` operator error; rules out re-reading gate stdio at settlement time, which the stage settler cannot reach.
- Bound the excerpt to a tail (mirroring `ready_gate_autofix_discarded`'s bounded `typecheckOutput`); rules out writing a 16MB gate transcript into a durable stage row.
- Leave `ready_gate_out_of_scope`'s existing outside-path fields untouched and additive-only; rules out reshaping the resume-admission fields that keyed off them.

## Required verification

- A settlement test drives a red gate and asserts the stage `failureDetail.message` contains the gate command and its stderr excerpt; it fails against the pre-fix `{ reason }`-only detail.
- A test asserts the excerpt is truncated at its bound for oversized gate output.

## Documentation updates

- `v2/docs/operator-runbook.md` — `failureDetail.message` is the first read for a red gate.
- `v2/docs/v1-behaviors.md` — red-gate stage settlement now carries gate command and output excerpt.

## Blocker

Artifact contract check failed: Plan subspec 00-name-red-gate-stage-failure-detail.md has a multi-surface ## Acceptance criteria bullet: `v2/src/execution/write-loop.test.ts` test `ready gate terminal evidence truncates oversized output to its tail` asserts a terminal `ready_gate_failed` record names the command, retains the last 4096 output characters, excludes the discarded prefix, and never persists the full oversized transcript; it fails against the pre-fix record with no gate evidence.
