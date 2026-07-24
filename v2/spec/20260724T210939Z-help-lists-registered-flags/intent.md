---
name: help-lists-registered-flags
---

# Help output lists each node's accepted flags

## Problem

`jarvis help` for `run workflow` presets (`intent`, `plan`, `implement`), `write`,
`cleanup`, `run list`, `daemon log`, and `run start` (write parity) does not list
accepted flags. Examples such as `--base`, `--spec`, `--ready-intent`, `--seed`,
`--review-passes`, `--review-behavior`, `--target-dir`, `--dry-run`, and `--abandon`
are discoverable only by reading source or docs.

## Decisions

- Registry nodes carry their accepted flags (name, argument shape, one-line description);
  help renders them. Rules out duplicating flag lists in prose usage strings that drift
  from the parsers.
- A registered flag missing from help output fails a test — coverage is asserted, not
  assumed.

## Acceptance criteria

- [ ] `jarvis help run workflow intent` (and the `plan`/`implement` presets) lists every
      accepted flag with a description.
- [ ] Flags for `write`, `cleanup`, `run list`, `daemon log` appear in their nodes' help.
- [ ] A test fails when a flag accepted by a command's parser is missing from that
      command's help output.
- [ ] `bun run typecheck`, `test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the CLI help surface.

## Prerequisites

- `jarvis help <command> [<subcommand>]` renders a registry-backed help node.
