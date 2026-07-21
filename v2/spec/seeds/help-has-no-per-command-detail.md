# `jarvis help` stops at the top level

## Problem

`jarvis help` lists seven top-level commands with one-line descriptions and nothing else. There is
no way to get help for a command or a subcommand:

```console
$ jarvis help run
usage: jarvis help

$ jarvis --help
unknown command: --help
did you mean help?

$ jarvis run workflow help
usage: jarvis run workflow <intent|plan|implement> [flags]
```

`jarvis help run` prints the help command's own usage — actively misleading. Nothing anywhere
documents `run`'s subcommands (`start`, `list`, `log`, `pause`, `resume`, `kill`, `wait`,
`workflow`), and no command lists its flags: `--base`, `--spec`, `--ready-intent`, `--seed`,
`--review-passes`, `--review-behavior`, `--target-dir`, `--dry-run`, `--abandon`, `--no-auto-bounce`
are discoverable only by reading source or docs. The registry-backed help added in #1847 covers the
top level only.

## Decisions

- `jarvis help <command> [<subcommand>]` prints that node's usage, its subcommands, and its flags,
  sourced from the same registry that backs top-level help. Rules out hand-maintained help strings
  that drift from the parsers.
- Accept `--help`/`-h` at any level as an alias for the same output, instead of the current
  `unknown command`.
- An unknown argument to `help` reuses the existing did-you-mean suggestion (#1852).
- Rules out a new `jarvis docs`-style command; help is the one surface.

## Acceptance criteria

- [ ] `jarvis help run` lists every `run` subcommand with a one-line description; `jarvis help run workflow`
      lists the presets and every accepted flag.
- [ ] `jarvis --help` and `jarvis run workflow --help` print the same output as the corresponding
      `help` invocation and exit zero.
- [ ] Help output for flags is derived from the registry, and a registered command or flag missing
      from help fails a test.
- [ ] `jarvis help <unknown>` emits the existing did-you-mean suggestion and exits non-zero.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the CLI help surface.
