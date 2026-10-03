---
name: retire-config-command
---

# Retire the config command and document agent-order management

## Problem

`config` has no internal caller and is superseded by `init` for bootstrap; `install-and-config.md` uses `config path` as the smoke check. The `set-agents` subcommand exists to reorder the agent fallback list but is rarely needed (most operator edits are hand-edits to `~/.jarvis/config.json`). The command adds API surface without a clear maintenance home.

## Decisions

- Delete the `config` command entirely (v2/src/commands/config.ts).
- Re-point the install smoke check from `jarvis config path` to a different verifier; `jarvis help` or `jarvis init --help` are candidates.
- Plan must decide: fold `set-agents` logic into `init` as a bootstrap-time choice, or document hand-editing `~/.jarvis/config.json` as the intended mechanism.
- Rules out leaving config in place to avoid a bootstrap ceremony.

## Prerequisites

## Acceptance criteria

- [x] `v2/src/commands/config.ts` is deleted and `jarvis config` is an unknown command.
- [x] `jarvis help` does not list `config` as a command.
- [x] Agent-order management is documented with a clear home (either in `init` command or as hand-edit guidance in `v2/docs/install-and-config.md` or `v2/docs/agent-model-config.md`, per plan decision).
- [x] Install smoke check works and passes; the verify line in `v2/docs/install-and-config.md` is updated from `jarvis config path` to the documented alternative (e.g., `jarvis help`, `init`, or equivalent).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — remove `config` command references; replace the smoke check line with the planned alternative (per plan decision on set-agents placement); document agent-order management home.
- `v2/docs/operator-runbook.md` — remove any `config set-agents` recovery steps; link to documented agent-order management home.
- `v2/docs/write-behavior.md` — remove any documentation of `config` command surface.
- `v2/docs/v1-behaviors.md` — record `config` command retirement.

## Primary implementation surface

- `v2/src/commands/config.ts` (delete entire file)
- `v2/src/cli.ts` (remove config from command dispatch)
- `v2/src/commands/init.ts` (conditionally add set-agents logic if plan decides)
- `v2/docs/install-and-config.md` (document hand-edit or init-based agent order)
