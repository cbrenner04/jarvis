---
name: registry-backed-command-help
---

# Registry-backed v2 command help

## Outcome

- `jarvis help` prints every v2 top-level command with a one-line summary and exits 0.
- Existing commands dispatch unchanged through the same queryable `{name, summary, usage}` registry that renders help and supplies recognized command names.

## Decisions

- Register `help` alongside the other top-level commands; rules out a hidden special case omitted from its own overview.
- Make the registry the sole command-name source for dispatch, help, and unknown-command recognition; rules out parallel lists that can drift.
- Preserve no-argument and `--version` behavior outside command dispatch; rules out expanding this slice into global option redesign.

## Acceptance criteria

- [ ] `jarvis help` writes every registered command and its non-empty one-line summary to stdout, writes nothing to stderr, and exits 0.
- [ ] A `v2/src/cli.test.ts` regression covering `jarvis help` fails against the baseline and passes after implementation.
- [ ] Every dispatched top-level command has one registry entry with non-empty `summary` and `usage` fields, and recognized-command output is derived from those entries.
- [ ] Existing `v2/src/cli.test.ts` and `v2/src/commands/*.test.ts` dispatch coverage stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — document `jarvis help` and the registry as the top-level CLI source of truth.
- `v2/docs/v1-behaviors.md` — record the v2 help surface and registry-backed dispatch while preserving existing command behavior.

## Prerequisites

- An unknown v2 top-level command names the recognized dispatch set on stderr and exits non-zero.
