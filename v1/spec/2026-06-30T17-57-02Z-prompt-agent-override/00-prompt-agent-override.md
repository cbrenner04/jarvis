# Prompt `--agent` override

`jarvis1 prompt` always walks `modes.prompt.agentOrder`. Probing one agent (e.g. opencode after a config change) requires editing `~/.jarvis/config.json`, running, then restoring. Add `--agent` on the prompt subcommand to pin the primary agent for one invocation without mutating config.

## Decisions

- `--agent` is parsed on the `prompt` subcommand argv (alongside `--repo`); rules out pre-subcommand global argv parsing before a shared multi-mode parser exists.
- Single `--agent` value per invocation (not repeatable); rules out building a full one-off ladder like the planned `run`/`plan` override.
- When `--agent` is set, the pinned agent runs first; remaining `modes.prompt.agentOrder` entries follow in config order with duplicate agent names skipped; rules out replacing the whole ladder with only the pinned agent.
- Pinned agent model comes from `--agent <name>:<model>`, else optional `--model`, else the matching `modes.prompt.agentOrder` entry model, else the agent default; rules out always requiring a config `agentOrder` row for the pinned name.
- Deferred to first consumer: precedence when `--agent <name>:<model>` and `--model` both specify a model — pin when implementing CLI parsing.
- Unknown `--agent` name exits non-zero and lists supported agent names (`claude`, `codex`, `cursor`, `opencode`); rules out silent fallback to `agentOrder` when the operator named a specific agent.
- Validation is against the supported agent-name set, not membership in `modes.prompt.agentOrder`; rules out requiring the pinned agent to appear in config order first.
- Quota, `model_config`, generic `error`, timeout, telemetry, and exit-code policy stay on the existing prompt loop; rules out a parallel invocation path that masks real agent failures.
- `modes.prompt.agentOrder` on disk is unchanged; rules out persisting override into config.
- Non-`prompt` subcommands that receive `--agent` exit non-zero with a usage error; rules out silent ignore on other modes.

## Tasks

- [ ] Parse `--agent` and optional `--model` on `jarvis1 prompt`; update usage/help strings.
- [ ] Build the effective prompt agent list (pinned first, then deduped config suffix).
- [ ] Reject unknown agent names before worktree creation.
- [ ] Reject `--agent` on non-prompt subcommands.
- [ ] Add focused CLI and `promptCommand` tests for pin, fallback, validation, and preservation.
- [ ] Update durable docs listed below.

## Acceptance criteria

- [ ] `jarvis1 prompt --agent <name> <text>` invokes `<name>` before any earlier `modes.prompt.agentOrder` entry when order differs.
- [ ] With `--agent` set, a `quota` or `model_config` result on the pinned agent advances to the next entry in the effective list (config suffix); generic `error` and iteration timeout still halt immediately with exit `3` or `8`.
- [ ] With `--agent` set and every attempted agent returning `quota`, the command exits `2` only after the full effective list is exhausted.
- [ ] `jarvis1 prompt --agent bogus <text>` exits non-zero before agent invocation and stderr lists the supported agent names.
- [ ] `jarvis1 prompt --agent <name>:<model> <text>` passes `<model>` to the pinned agent without editing config.
- [ ] `jarvis1 run --agent claude <spec>` (and `jarvis1 plan --agent claude <target>`) exits non-zero with a clear usage error; no agent invocation.
- [ ] `v1/test/modes/prompt/run.test.ts` stays green when `--agent` is omitted (behavior unchanged).
- [ ] `v1/docs/agents.md` documents `--agent` / optional model override and precedence over `modes.prompt.agentOrder`.
- [ ] `v1/docs/specless-prompt.md` documents `--agent` on the prompt invocation surface.
- [ ] `v1/docs/operator-runbook.md` documents `jarvis1 prompt --agent` as the path to verify a configured agent without config reorder surgery.
- [ ] `v2/docs/v1-behaviors.md` records prompt-mode `--agent` override behavior with source citations.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- `v1/docs/agents.md` — `--agent` precedence vs `modes.prompt.agentOrder`.
- `v1/docs/specless-prompt.md` — `--agent` (and model override once conflict syntax is pinned) on the prompt surface.
- `v1/docs/operator-runbook.md` — `jarvis1 prompt --agent` verification path; no config-surgery workaround for prompt-mode agent checks.
- `v2/docs/v1-behaviors.md` — prompt-mode `--agent` override.
