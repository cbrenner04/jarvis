---
name: help-on-usage-errors
---

# Usage errors point at the offending command, not the whole overview

A typo'd command or a bad flag dumps the entire top-level usage to stderr, burying the
error. Make failures targeted.

- An unknown command prints the error plus a "did you mean" suggestion when one command is
  a close match, and a one-line pointer to `jarvis1 help`; it does not dump the full
  overview.
- A parse error scoped to a known command (missing flag value, bad `--tier`, unsupported
  `--agent`) prints that command's usage, not the top-level overview (today only `runbook:`
  errors do this).
- Both paths still exit 1 and write to stderr.

Changes existing behavior: update `v2/docs/v1-behaviors.md`.

## Prerequisites

- `parseArgs` returns distinguishable `unknown` and `error` results for bad invocations.
