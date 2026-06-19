# Stall cause finding

Investigate real stalled patch iterations and commit a written finding that
names the dominant stall cause with per-iteration evidence so a remediation
decision (e.g. idle-output watchdog) is grounded, not guessed.

## Problem

Iterations repeatedly burn the full `iterationTimeoutMs` before the watchdog
aborts them. The dominant cause is unconfirmed: agent waiting on a hung
subprocess it spawned vs. the agent genuinely idle with no output. Remediation
scope cannot be chosen without evidence from `last_output_age_ms` and
`watchdog_descendants_alive` on real `watchdog-iteration-timeout` rows.

## Decisions

- Deliverable is `finding.md` in this spec directory; no harness code or durable
  doc change. Rules out folding investigation into a remediation PR that presumes
  the cause.
- Evidence from operator `~/.jarvis/runs.jsonl` and matching session logs only.
  Rules out synthetic test fixtures or new telemetry fields.
- ≥3 distinct `watchdog-iteration-timeout` iterations cited with full
  diagnostic fields per case. Rules out aggregate impressions or unfalsifiable
  "agents are slow" conclusions.
- Per-case classification: `hung-subprocess`, `agent-idle`, or `other`, keyed to
  `last_output_age_ms` and `watchdog_descendants_alive` plus log context.
  Rules out listing causes without per-iteration reasoning.
- Dominant cause = single primary category across cited cases; minority patterns
  named explicitly. Rules out an unranked bullet list of hypotheses.
- Mandatory idle-bound verdict: `warranted` or `not-warranted`; if warranted,
  sketch a bound relative to `iterationTimeoutMs` and cited
  `last_output_age_ms` values — not a committed config default. Rules out
  deferring the remediation judgment to a follow-up.
- Deferred to first consumer: exact idle-bound default and config key — pin when
  idle-output-watchdog intent implements the knob.

## Task checklist

- [ ] Locate stalled runs: `watchdog-iteration-timeout` rows at or near full
  `iterationTimeoutMs` in `~/.jarvis/runs.jsonl`.
- [ ] For each candidate iteration, extract `last_output_age_ms`,
  `watchdog_descendants_alive`, `watchdog_pgid`, run id, iteration index, and
  the session-log `[watchdog]` line for that iteration.
- [ ] Classify each cited case (`hung-subprocess`, `agent-idle`, `other`) from
  the diagnostics and log context.
- [ ] Determine the dominant cause across cited cases; note minority patterns.
- [ ] Record idle-bound verdict (`warranted` / `not-warranted`) with rationale;
  if warranted, sketch a bound from cited ages and `iterationTimeoutMs`.
- [ ] Write `finding.md`.

## Acceptance criteria

- [ ] `finding.md` cites ≥3 distinct `watchdog-iteration-timeout` iterations,
  each with run id, iteration index, `last_output_age_ms`,
  `watchdog_descendants_alive`, and a session-log excerpt traceable to that
  iteration; cited field values match the corresponding `runs.jsonl` rows.
- [ ] Each cited iteration includes a per-case stall classification
  (`hung-subprocess`, `agent-idle`, or `other`) keyed to its diagnostic fields
  and log context.
- [ ] Finding names one dominant stall cause derived from the cited cases and
  notes any minority pattern.
- [ ] Finding records an explicit idle-bound verdict (`warranted` or
  `not-warranted`); if warranted, sketches a bound using cited
  `last_output_age_ms` values and `iterationTimeoutMs`.
- [ ] This PR changes only files under this spec directory (no edits under
  `v1/src/`, `shared/`, `v1/docs/`, or `v2/docs/`).

## Documentation updates

- [ ] `finding.md` in this spec tree (work intent / evidence per
  `v2/docs/documentation-standard.md`).
- No durable `v1/docs` or `v2/docs` change in this slice.

## Out of scope

- Implementing any abort bound or watchdog change.
- Changing telemetry shape.
- Synthetic reproduction via patch-mode test fixtures (consumes production
  telemetry only).
