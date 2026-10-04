---
name: intent-agent-flag-rejected-by-dispatcher
---

# `jarvis1 intent --agent` is rejected by the CLI dispatcher despite being supported

`jarvis1 intent --agent <name>[:<model>]` exits with `intent: --agent is not supported`
even though `intent.ts` already parses `--agent` and applies it to `modes.plan.agentOrder`
(`v1/src/commands/intent.ts:671-681`). The dispatcher's `AGENT_FLAG_SUBCOMMANDS` guard
(`v1/src/cli.ts:183`) is `new Set(["run", "plan", "prompt"])` and omits `"intent"`, so
`parseArgs` short-circuits before intent's own parser runs.

## Decisions

- Add `"intent"` to `AGENT_FLAG_SUBCOMMANDS` in `v1/src/cli.ts` — enables the
  already-built parse/override path, no new parsing logic needed.
- Add a CLI test asserting `jarvis1 intent --agent codex:gpt-5.5 <seed>` parses and
  applies the override instead of erroring.

## Out of scope

- Adding `--agent` to any subcommand that does not support it.
- Changing the override semantics documented in `agents.md`.

## Documentation updates

- Note in `v2/docs/v1-behaviors.md`: dispatcher now admits `--agent` for `intent`
  (changes existing CLI behavior).

## Prerequisites
