---
name: repeated-iteration-timeout-surfaces-split-signal
---

# Repeated iteration-timeouts on the same subspec surface a "split it" signal instead of re-walling silently

Some subspecs are legitimately too large for one 10-min iteration. Today each exit-8 is
handled independently with no memory of prior timeouts on the same subspec, so an oversized
subspec just re-walls every run with no escape hatch or signal that the plan itself needs
splitting.

## Decisions

- Track consecutive iteration-timeouts on the same active subspec across runs — rules out the
  current stateless handling where each exit-8 is independent and repetition goes unnoticed.
- After a configurable/reasonable number of consecutive timeouts on the same subspec, surface a
  clear "subspec too large — split it" signal to the operator (e.g. a run-summary note or
  `## Blocker`) rather than continuing to silently retry.

## Out of scope

- Automatically splitting the subspec.
- The checkpoint-commit and prompt-conditioning behaviors (separate intents).

## Documentation updates

- `v1/docs/run-loop.md` § "Stop conditions and exit codes": document the repeated-timeout
  counter and the split-signal it produces.
- `v1/docs/operator-runbook.md`: note the new signal and how to act on it (split the subspec).
- `v2/docs/v1-behaviors.md`: record the repeated-timeout detection behavior.

## Prerequisites
