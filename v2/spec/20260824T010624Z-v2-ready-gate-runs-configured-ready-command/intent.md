---
name: v2-ready-gate-runs-configured-ready-command
---

# v2 ready gate runs the configured project ready command

## Prerequisites

- `projects.<key>.readyCommand` and `projects.<key>.fixCommand` are validated non-empty strings in `~/.jarvis/config.json`.
- v2 resolves a registered project's `fixCommand` from machine config and carries it onto write steps across IPC (`readProjectFixCommand`, `v2/src/commands/workflow.ts`).

## Surface

CLI admission and project-config resolution.

## Problem

- v2's ready gate is hardcoded to `bun run ready` (`createDefaultRunReadyGate`, `v2/src/execution/ready-finalize.ts`); `readyCommand` is read only by v1, so every v2 run on a project without a `package.json` `ready` script red-gates with `Script not found "ready"`.

## Behavior

- A run whose project configures `readyCommand` runs that command as its ready gate; a project without one still runs `bun run ready`.

## Decisions

- Resolve `readyCommand` at CLI step admission alongside `fixCommand` and carry it on the write step as a JSON-serializable string; rules out reading machine config inside the daemon-hosted gate, where the run's project key is not the config-resolution seam.
- Thread the resolved command through both finalization gates that spawn it — completion (`ready-finalize.ts`) and terminal publication — rules out a completion-only override that leaves `terminalAction: ready|merge` still spawning `bun run ready`.
- Key ready-gate failure classification off the resolved command rather than the literal `"bun run ready"` (`classifyReadyGateFailure`); rules out silently downgrading every configured-command failure to unclassified.
- Report the resolved command in `ReadyGateError.command` and the repair prompt's `GATE_COMMAND`; rules out operator/agent output naming a command the run never ran.

## Required verification

- A ready-gate test with a configured `readyCommand` asserts the gate spawns that command, and a sibling without one asserts the `bun run ready` fallback; both fail against the pre-fix hardcode.
- A classification test asserts a configured-command failure still reaches out-of-scope classification.

## Documentation updates

- `v2/docs/install-and-config.md` — v2 `readyCommand`/`fixCommand` project overrides and the `bun run ready` default.
- `v2/docs/v1-behaviors.md` — v2 now honors the per-project ready command v1 already honored.
