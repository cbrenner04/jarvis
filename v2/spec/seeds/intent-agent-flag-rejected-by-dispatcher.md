---
name: intent-agent-flag-rejected-by-dispatcher
---

# `jarvis1 intent --agent` is rejected by the CLI dispatcher despite being supported

`jarvis1 intent --agent <name>[:<model>]` exits with `intent: --agent is not supported`,
even though `intent.ts` fully parses `--agent` (repeatable `agentFlags`) and both the
top-level usage and `INTENT_USAGE` advertise `[--agent <name>[:<model>]]`. The block is a
stale dispatcher guard: `AGENT_FLAG_SUBCOMMANDS` in `v1/src/cli.ts` is
`new Set(["run", "plan", "prompt"])` — it omits `"intent"`, so `parseArgs` short-circuits
with the not-supported error before intent's own parser runs. Operators can't apply a
per-run actuator override (e.g. codex-first) to intent splits, contradicting the
documented flag.

## Decisions

- Add `"intent"` to `AGENT_FLAG_SUBCOMMANDS` (`v1/src/cli.ts`) so the dispatcher lets
  `--agent` through to `intent.ts`'s existing parser — the fix is enabling the already-built
  path, not adding new parsing.
- Confirm the parsed `agentFlags` actually override `modes.plan.agentOrder` for the intent
  split actuation (per `agents.md` § per-run override); wire it through if the parse result
  is currently dropped.
- Add a CLI test asserting `jarvis1 intent --agent codex:gpt-5.5 <seed>` parses and applies
  the override instead of erroring — the missing test is why the guard/parser drift shipped.

## Out of scope

- Adding `--agent` to any subcommand that genuinely does not support it.
- Changing the override semantics documented in `agents.md`.

## Documentation updates

- None expected — `agents.md` and the usage strings already document `intent --agent`; this
  makes the code match the docs. Note the fix in `v2/docs/v1-behaviors.md` (dispatcher now
  admits `--agent` for intent) since it changes existing CLI behavior.
