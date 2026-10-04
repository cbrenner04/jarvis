---
name: run-workflow-exit-status-tracks-run-outcome
---

# `run workflow` exit status tracks the run outcome, not request acceptance

`jarvis run workflow <name>` currently exits `0` as soon as the daemon accepts the
start request. A run that reaches `runStatus: failed` seconds later still leaves the
shell at exit 0, so nothing can be scripted or gated on it.

Make the exit status trustworthy: a failed run must never exit 0. `run workflow`
blocks until the run reaches a terminal state and mirrors that outcome into its
exit code, matching the `jarvis1 run` / `jarvis run wait` semantics the operator
already has — reuse `jarvis run wait`'s existing terminal-outcome and exit-code
mapping rather than inventing a second one. Document the new blocking contract.

## Documentation updates

- `v2/docs/write-behavior.md` — CLI surface table: exit-status contract for
  `run workflow`.
- `v2/docs/operator-runbook.md` — drop the "exit 0 means launched, not succeeded"
  caveat.

## Out of scope

- The underlying preset failures (`invalid-token-discards-completed-work`,
  `implement-write-step-renders-prompt-without-placeholders`).

## Prerequisites
