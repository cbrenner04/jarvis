---
name: zero-output-iteration-is-a-harness-defect
---

# A patch iteration with zero observed output is reported as a harness defect

## Problem

The claude blindness went unnoticed for 33 runs because a run that observes no
output at all is indistinguishable, in the record and in the operator-facing
summary, from a run whose agent genuinely idled. Nothing surfaces "we measured
nothing." That is what let the bug get misdiagnosed as model slowness and pool
contention.

## Decisions

- Zero observed output across a completed patch iteration is a harness defect, not a
  normal idle timeout: surface it to the operator and mark it in the run record.
  Ruling out: silently recording `last_output_age_ms: null`, which is the status quo
  that hid this for months.
- Applies to any configured agent, not just claude — the guard is what prevents the
  next binding from regressing silently.

## Out of scope

- Failing the run. This is a visibility guard; it must not change exit codes or the
  escalation ladder.

## Acceptance criteria (behavioral)

- A patch iteration that completes having observed no agent output emits a distinct,
  named harness warning naming the agent, rather than being reported as an ordinary
  idle/iteration timeout.
- The condition is distinguishable in `~/.jarvis/runs.jsonl` from a run that observed
  output and then went idle.
- The guard fires for any configured agent binding.

## Documentation updates

- `v1/docs/quota-signals.md` — the zero-output condition and what an operator should
  do when it appears.
- `v2/docs/v1-behaviors.md`.

## Prerequisites

- Claude patch runs populate `last_output_age_ms` (otherwise the guard fires on every claude run).
