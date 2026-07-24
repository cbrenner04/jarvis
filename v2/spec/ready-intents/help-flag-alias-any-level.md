---
name: help-flag-alias-any-level
---

# `--help`/`-h` works at any level

## Problem

`jarvis --help` prints `unknown command: --help`. No command accepts `--help` or `-h`;
operators must know the `jarvis help ...` form.

## Decisions

- `--help`/`-h` anywhere in the argument path prints the same output as the corresponding
  `help` invocation and exits zero. Rules out per-command flag handling inside each parser.
- Handled before command-specific argument parsing, so `jarvis run workflow --help`
  succeeds rather than failing validation on missing required flags.

## Acceptance criteria

- [ ] `jarvis --help` and `jarvis -h` print the same output as `jarvis help` and exit zero.
- [ ] `jarvis run workflow --help` prints the same output as `jarvis help run workflow` and
      exits zero.
- [ ] A test asserts the alias output matches the `help` output for every registry node.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the CLI help surface.

## Prerequisites

- `jarvis help <command> [<subcommand>]` renders a registry-backed help node.
