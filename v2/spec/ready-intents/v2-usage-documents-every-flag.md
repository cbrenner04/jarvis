---
name: v2-usage-documents-every-flag
---

# Per-command usage documents every flag, with an example

Today's usage lines are one-liners, not documentation: `RUN_USAGE` names seven subcommands and
describes none, and no command documents its flags or shows an invocation.

Fill in the registry's usage blocks so each command and subcommand lists every flag its parser
accepts with a one-line description, and ends with at least one real invocation.

A test fails when the parser accepts a flag the command's usage text does not document. This is
the part that keeps help honest — without a drift guard against `parseArgs`, the rest rots.

## Prerequisites

- `jarvis help` prints an overview from a registry of v2's commands, summaries, and usage text
- `jarvis help <command>` and `jarvis <command> --help` print that command's usage block
