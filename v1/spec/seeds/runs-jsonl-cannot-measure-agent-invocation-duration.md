# `runs.jsonl` can't tell you how long an agent invocation takes

`iterationTimeoutMs` bounds the **agent invocation**. Nothing in `~/.jarvis/runs.jsonl`
measures an agent invocation. So the one number the operator must choose is the one
number the telemetry cannot inform.

## Problem

Observed 2026-07-13, trying to set `iterationTimeoutMs` from data rather than guessing.

`duration_ms` looks like the right field and is not:

- Rows with `record_role: "run_terminal"` are **whole-run** durations — every iteration,
  plus the ready gate, plus review.
- Rows with `record_role: null` are per-iteration, but `duration_ms` still spans the
  gate and review phases, which the watchdog does not bound.

Proof they can't be invocation time: a `criteria-complete` row shows **32 minutes at
`iteration: 1`** while `iterationTimeoutMs` was 600000 (10 min). A single agent
invocation could not have survived that wall. The clock is measuring something the wall
doesn't govern.

Naively percentiling `duration_ms` produces a confident, wrong answer — it suggested a
10-minute wall was killing 18.5% of successful iterations, which is not a claim the data
supports.

## Why it matters now

Three claude patch runs this session hit the wall with **0 completed iterations**. One of
them had `last_output_age_ms: 186` at the kill — actively streaming, not stalled. It
simply needed more than 10 minutes of invocation time. That is the clearest possible
signal that the wall was mis-set, and there was no way to derive the right value.

The current settings (`iterationTimeoutMs: 1800000`, `idleOutputTimeoutMs: 120000`) are a
reasoned guess from a single day's failures, not a measurement.

## Scope

- Record agent **invocation** duration as its own field, distinct from iteration duration
  and run duration: spawn → settle, excluding gate and review.
- Enough to answer, per agent and per mode: what does the invocation-duration distribution
  look like, and what wall would kill what fraction of invocations that would otherwise
  have succeeded?
- Make the existing `duration_ms` semantics explicit in the schema docs — its meaning
  currently varies by `record_role`, silently.

## Decisions

- Measure the thing the timeout governs. Any other clock is a proxy that will mislead
  exactly when it matters.
- `run-invocation-session-log` (#1464) already stamps spawn and settle per invocation —
  the timing may be derivable from it, or the two should share a source rather than
  diverge.

## Out of scope

- Choosing new timeout defaults. This seed makes the choice measurable; it does not make
  the choice.
- The idle-vs-wall relationship — see
  `idle-output-timeout-defaults-equal-to-the-iteration-wall`.

## Documentation updates

- `v1/docs/quota-signals.md` (or wherever the `runs.jsonl` schema lives) — what each
  duration field measures, and which record roles carry which.
