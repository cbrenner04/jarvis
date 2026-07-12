---
name: help-topic-routing
---

# `jarvis1 help <command>` routes to per-command usage

Today only `jarvis1 <command> --help` reaches `COMMAND_USAGE`; `jarvis1 help run` silently
prints the generic top-level usage. Make `help` a first-class topic router.

- `jarvis1 help <command>` prints the same usage block as `jarvis1 <command> --help`, exit 0.
- Works for every registered command, including `plan`, `intent`, `runbook`.
- `jarvis1 help <unknown>` errors on stderr naming the unknown topic, lists the valid
  commands, exits 1 (it must not print topic help as if it succeeded).
- `jarvis1 help` with no topic keeps printing the overview.

Changes existing behavior: update `v2/docs/v1-behaviors.md`.

## Prerequisites

- `jarvis1 <command> --help` prints per-command usage text.
