---
name: per-command-help-completeness
---

# Every command's help documents its flags and shows an example

Per-command usage is uneven: `run`/`prompt` have a `Flags:` section, while `cleanup`,
`triage`, `config`, `prices`, `runbook` document flags only inside prose or not at all, and
no command shows a real invocation.

- Every command's usage text has a `Flags:` section listing each flag it accepts with a
  one-line description (commands with no flags say so or omit the section deliberately).
- Every command's usage text ends with an `Examples:` section showing at least one real
  invocation.
- A test fails when a flag `parseArgs` accepts for a command is absent from that command's
  usage text, so help can't drift from the parser.

Changes existing behavior: update `v2/docs/v1-behaviors.md`.

## Prerequisites

- `jarvis1 <command> --help` prints per-command usage text.
