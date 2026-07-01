---
name: prompt-agent-override
---

# `--agent` override on `jarvis1 prompt`

No jarvis command pins agent selection for one invocation; `jarvis1 prompt` always walks
`modes.prompt.agentOrder`. Verifying a configured agent (e.g. opencode after a config
change) requires hand-editing `~/.jarvis/config.json`, running, then restoring.

## Direction

Add a global `--agent <name>` flag honored by `jarvis1 prompt`, pinning primary agent
selection for that invocation. Optional model pinning via `<name>:<model>` and/or a
paired `--model` flag.

## Decisions

- Global `--agent <name>` on `jarvis1 prompt` pins primary selection for the invocation — rules out config reorder surgery to probe one agent.
- Override bypasses `modes.prompt.agentOrder` for the pinned agent but keeps existing quota, `model_config`, error, and timeout handling — rules out a parallel selection path that masks real agent failures.
- Unknown or unconfigured `--agent` name exits non-zero and prints the valid agent set — rules out silent fallback to `agentOrder` when the operator named a specific agent.
- Scope to `jarvis1 prompt` only; other modes ignore or reject the flag until a consumer needs it — rules out speculative wiring across every mode.
- Deferred to first consumer: colon (`name:model`) vs paired `--model` syntax when both are present — pin when implementing CLI parsing.

## Documentation updates

- `v1/docs/agents.md` — document `--agent` precedence vs `modes.prompt.agentOrder`.
- `v1/docs/specless-prompt.md` — document `--agent` (and model override once syntax is pinned) on the prompt invocation surface.
- `v1/docs/operator-runbook.md` — note `jarvis1 prompt --agent` as the verification path; remove any config-surgery workaround for prompt-mode agent checks once this ships.
- `v2/docs/v1-behaviors.md` — record prompt-mode `--agent` override behavior.

## Prerequisites
