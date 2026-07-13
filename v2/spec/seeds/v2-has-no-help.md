# v2 has no help

`jarvis help` is not a command in v2. It falls through the `write`/`daemon`/`config`/`run`/`tui`
dispatch chain in `v2/src/cli.ts:127-174` and prints `v2 not ready`, exit 0. `--help` is not
parsed anywhere, for any command.

## Problem

The only help text v2 has is a set of `*_USAGE` constants (`v2/src/cli.ts:76-96`). They are
printed to stderr on a parse error and nowhere else. So:

- **There is no way to ask what jarvis is or what it can do.** No overview, no command list.
  `jarvis help` answers `v2 not ready`, which reads as "the binary is broken."
- **There is no way to ask about a command.** `jarvis run --help` is not parsed; it reaches
  `run`'s dispatch as an unknown subcommand.
- **Discovering a command's flags requires provoking an error**, then reading the one-line
  usage that comes back.
- **Usage lines are one-liners, not documentation.** `RUN_USAGE` names seven subcommands and
  describes none. No command documents its flags or shows an example invocation.

Four ready-intents for this already exist in `v2/spec/ready-intents/`
(`help-overview-orientation`, `help-topic-routing`, `help-on-usage-errors`,
`per-command-help-completeness`). They are **being deleted alongside this seed**: they were
authored against v1's CLI — they say `jarvis1`, they enumerate commands v2 does not have
(`cleanup`, `triage`, `prices`, `runbook`), and they frame the work as improving an existing
help surface. v2 has none to improve. This seed replaces them; re-split it through
`jarvis intent`.

## Scope

- `jarvis help` — an overview: one line on what jarvis is, then commands by name and one-line
  summary, grouped by operator lifecycle. Short enough to read in one screen. No flag
  signatures inline.
- `jarvis help <command>` and `jarvis <command> --help` — the same per-command usage block,
  exit 0. Both forms, for every registered command and subcommand.
- Per-command usage documents every flag the parser accepts, with a one-line description, and
  ends with at least one real invocation.
- `jarvis help <unknown>` names the unknown topic on stderr, lists valid commands, exits 1.

## Decisions

- **Scope to v2's real command set** — `write`, `daemon`, `config`, `run`, `tui`, and `run`'s
  subcommands including `workflow` and its presets. Rules out carrying over v1's command
  vocabulary, which is what made the previous four intents unusable.
- **Help is a v2 addition, not a v1 behavior change.** No `v2/docs/v1-behaviors.md` update.
  v1's help stays as it is — it is not worth work on a surface being retired.
- **A test fails when the parser accepts a flag the command's usage text does not document**,
  so help cannot drift from `parseArgs`. This is the only part that keeps help honest over
  time; without it the rest rots.
- Unknown *command* behavior (not `help <unknown>`): print the error plus a "did you mean"
  when one command is a close match, and a pointer to `jarvis help`. Rules out today's
  `v2 not ready` fallthrough, which reports success on a typo.

## Prerequisites

- None. `v2/src/cli.ts` already holds per-command usage strings to build on.

## Out of scope

- Any change to v1's help.
- Man pages, shell completion, `--help` output formatting beyond plain text.

## Documentation updates

- `v2/docs/` — the help surface and the parser/usage drift test.
