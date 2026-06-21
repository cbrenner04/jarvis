# `run --help` usage + subcommand audit

## Problem

`jarvis run --help` is parsed as a spec path: `parseArgs` (`v1/src/cli.ts:102-189`)
consumes known flags and then treats the first leftover token as `specPath`, so
`--help` flows through to `spec path does not exist: …/--help`. Only `plan` and
`intent` short-circuit on `--help`/`-h`. Several other subcommands silently
misinterpret it: `cleanup` ignores it and runs anyway, `triage`/`review-feedback`
take it as a worktree name, `prompt` takes it as the prompt text.

## Decisions

- `run --help`/`-h` prints a `run`-specific usage string and exits 0 without
  attempting spec resolution. Rules out routing it to the global `USAGE` only, which
  buries the run flag list the operator asked for.
- Audit and fix every subcommand that currently misinterprets `--help`/`-h`
  (`run`, `init`, `config`, `log-server`, `cleanup`, `triage`, `review-feedback`,
  `prompt`, `prices`): each recognizes the flag, prints help, and exits 0 instead of
  running or erroring. Rules out fixing `run` alone and leaving the same papercut in
  sibling commands the intent explicitly calls out.
- A subcommand with no dedicated usage string falls back to the global `USAGE`. Rules
  out inventing per-command usage text for commands that don't warrant it — keep it
  bounded.

## Task checklist

- [ ] Short-circuit `run --help`/`-h` to a run usage string, exit 0, before spec resolution.
- [ ] Recognize `--help`/`-h` in the remaining subcommands; print help, exit 0.
- [ ] Document the help behavior.

## Acceptance criteria

- [ ] `jarvis run --help` and `jarvis run -h` print run usage to stdout and exit 0
      without producing a `spec path does not exist` error.
- [ ] `cleanup`, `triage`, `review-feedback`, and `prompt` no longer misinterpret a
      `--help`/`-h` argument as data (a worktree name, prompt text, or a silent run);
      each prints help and exits 0.
- [ ] Existing `cli`/`parseArgs` tests stay green except where they are extended to
      cover the new `--help` handling.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record that every subcommand honors `--help`/`-h`.
