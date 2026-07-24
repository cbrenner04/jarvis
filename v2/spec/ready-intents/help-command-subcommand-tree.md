---
name: help-command-subcommand-tree
---

# `jarvis help <command>` prints that command's subcommands

## Problem

`jarvis help` lists seven top-level commands and stops. `jarvis help run` prints
`usage: jarvis help` — the help command's own usage — and nothing documents `run`'s
subcommands (`start`, `list`, `log`, `pause`, `resume`, `kill`, `wait`, `workflow`) or
`run workflow`'s presets. The registry in `v2/src/cli.ts` knows only a flat command list
with one opaque usage string per command.

## Decisions

- Extend the command registry to a tree: each entry may carry named subcommands with
  one-line summaries. Rules out hand-maintained help strings that drift from the parsers.
- `jarvis help <command> [<subcommand>]` prints that node's usage line plus its
  subcommands; `jarvis help` keeps its current top-level output.
- Unknown argument to `help` reuses the existing did-you-mean suggestion and exits
  non-zero.
- Flags are out of scope here; this slice covers node/subcommand discovery only.

## Acceptance criteria

- [ ] `jarvis help run` lists every `run` subcommand with a one-line description.
- [ ] `jarvis help run workflow` lists the `intent`, `plan`, `implement` presets.
- [ ] `jarvis help <unknown>` and `jarvis help run <unknown>` emit the did-you-mean
      suggestion and exit non-zero.
- [ ] A test fails if a dispatchable command or subcommand is absent from the registry tree.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the CLI help surface.

## Prerequisites

- The CLI dispatches top-level commands from a single registry that also backs `jarvis help`.
