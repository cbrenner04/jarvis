---
name: v2-per-command-help-routing
---

# `jarvis help <command>` and `jarvis <command> --help`

Neither form is parsed in v2 today: `jarvis run --help` reaches `run`'s dispatch as an unknown
subcommand, and `--help` is not a parser option anywhere. Discovering a command's flags requires
provoking a parse error and reading the one-line usage that comes back.

Route both forms to the same per-command usage block from the registry, on stdout, exit 0, for
every registered command and subcommand — including `run workflow` and each of its presets
(`implement`, `intent`, `intent-reviewed`, `plan`, `plan-reviewed`, `plan-reviewed-light`).

`jarvis help <unknown>` names the unknown topic on stderr, lists valid commands, exits 1.

This slice is routing and exit codes; the *content* of each usage block (flag coverage, examples)
is a separate slice.

## Prerequisites

- `jarvis help` prints an overview from a registry of v2's commands, summaries, and usage text
