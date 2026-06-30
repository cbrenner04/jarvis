# Prompt `--agent` override

`jarvis1 prompt` always walks `modes.prompt.agentOrder`. Probing one agent (e.g. opencode after a config change) requires editing `~/.jarvis/config.json`, running, then restoring. Add `--agent` on the prompt subcommand to pin the primary agent for one invocation without mutating config.

## Decisions

- `--agent` is parsed on the `prompt` subcommand argv (alongside `--repo` and optional `--model`); rules out pre-subcommand global argv parsing before a shared multi-mode parser exists.
- Single `--agent` value per invocation (not repeatable); rules out building a full one-off ladder like the planned `run`/`plan` override.
- When `--agent` is set, the pinned agent runs first; remaining `modes.prompt.agentOrder` entries follow in config order with duplicate agent names skipped; rules out replacing the whole ladder with only the pinned agent.
- When `modes.prompt.agentOrder` is empty, `--agent <valid-name>` yields an effective list of one (pinned only); rules out exiting with empty-agent/config errors.
- Pinned agent model comes from `--agent <name>:<model>`, else optional `--model`, else the matching `modes.prompt.agentOrder` entry model, else the agent default; rules out always requiring a config `agentOrder` row for the pinned name.
- When both `--agent <name>:<model>` and `--model` specify a model, the colon form on `--agent` wins; rules out `--model` overriding an inline model on `--agent`.
- Unknown or malformed `--agent` values fail in `parseArgs` / CLI validation (same layer as `--repo` and empty prompt text), before worktree creation or agent invocation; rules out deferred rejection after scaffold setup.
- Agent-name validation uses `isAgentName` / `AGENT_NAMES` from `v1/src/config.ts`; stderr lists the derived set; rules out hardcoded agent enumerations that stale when agents are added.
- Validation is against the supported agent-name set, not membership in `modes.prompt.agentOrder`; rules out requiring the pinned agent to appear in config order first.
- Effective prompt agent list replaces `buildActivePromptAgents` with per-entry `{ agent, model }` used for invocation and summary/telemetry attribution; rules out config-only model lookup that misreports `configuredModel` for pinned agents absent from config or using override models.
- Quota, `model_config`, generic `error`, timeout, and exit-code policy stay on the existing prompt loop; rules out a parallel invocation path that masks real agent failures.
- `modes.prompt.agentOrder` on disk is unchanged; rules out persisting override into config.
- Non-`prompt` subcommands that receive `--agent` exit non-zero with a usage error; rules out silent ignore on other modes.

## Tasks

- [ ] Parse `--agent` and optional `--model` on `jarvis1 prompt`; update usage/help strings.
- [ ] Build effective prompt agent list (pinned first, deduped config suffix) as `{ agent, model }[]`; wire through invocation and telemetry.
- [ ] Reject unknown/malformed `--agent` in `parseArgs` before worktree creation.
- [ ] Reject `--agent` on non-prompt subcommands.
- [ ] Add `parseArgs` tests in `v1/test/cli.sandbox-unrunnable.test.ts` (flag parsing, validation, malformed flags).
- [ ] Add `promptCommand` integration tests (effective list, fallback, telemetry model).
- [ ] Update durable docs listed below.

## Acceptance criteria

- [ ] `jarvis1 prompt --agent opencode <text>` with `agentOrder` `[claude, cursor]` attempts `opencode` first (pinned agent absent from config order).
- [ ] `jarvis1 prompt --agent <name> <text>` invokes `<name>` before any earlier `modes.prompt.agentOrder` entry when order differs.
- [ ] With empty `modes.prompt.agentOrder`, `jarvis1 prompt --agent <valid-name> <text>` runs only the pinned agent (effective list length 1).
- [ ] When `--agent` names an agent already in `agentOrder`, that agent runs once (pinned first); the config duplicate is skipped in the suffix.
- [ ] With `--agent` set, a `quota` or `model_config` result on the pinned agent advances to the next entry in the effective list; generic `error` and iteration timeout still halt immediately with exit `3` or `8`.
- [ ] With `--agent` set and every attempted agent returning `quota`, the command exits `2` only after the full effective list is exhausted.
- [ ] `jarvis1 prompt --agent bogus <text>` exits non-zero before worktree creation (no worktree side effects); stderr lists agent names from `AGENT_NAMES`.
- [ ] Missing `--agent` value, duplicate `--agent`, or empty agent name (e.g. `--agent :model`) → usage error, exit `1`, no agent invocation.
- [ ] `jarvis1 prompt --repo <name> --agent <name> --model <model> "multi word text"` preserves repo, agent, model, and quoted prompt text (flags before positional).
- [ ] `jarvis1 prompt --agent <name>:<model> <text>` passes `<model>` to the pinned agent without editing config.
- [ ] `jarvis1 prompt --agent <name> --model <model> <text>` passes `<model>` to the pinned agent without editing config.
- [ ] With no CLI model override, a pinned agent with a matching `agentOrder` row uses that row's model; a pinned agent absent from `agentOrder` uses the agent default.
- [ ] When both `--agent <name>:<model>` and `--model <other>` are set, the pinned agent receives the colon model, not `--model`.
- [ ] Effective-list `{ agent, model }` drives invocation and summary/telemetry `configuredModel` for pinned agents absent from config or using override models.
- [ ] `jarvis1 run --agent claude <spec>` (and `jarvis1 plan --agent claude <target>`) exits non-zero with a clear usage error; no agent invocation.
- [ ] `v1/test/cli.sandbox-unrunnable.test.ts` covers `--agent` / `--model` parseArgs (valid, malformed, non-prompt rejection).
- [ ] `promptCommand` integration tests cover effective list, quota fallback, and telemetry model attribution.
- [ ] `v1/test/modes/prompt/run.test.ts` stays green when `--agent` is omitted (behavior unchanged).
- [ ] `v1/docs/agents.md` documents `--agent` / optional model override and precedence over `modes.prompt.agentOrder`.
- [ ] `v1/docs/specless-prompt.md` documents `--agent`, `--model`, and colon-vs-`--model` precedence on the prompt surface.
- [ ] `v1/docs/operator-runbook.md` documents `jarvis1 prompt --agent` as prompt-mode agent verification and cross-links seed `per-run-agent-override-flag` for future `run`/`plan` override.
- [ ] `v2/docs/v1-behaviors.md` records prompt-mode `--agent` override (prompt verification now; `per-run-agent-override-flag` remains tracker for `run`/`plan`) with source citations.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- `v1/docs/agents.md` — `--agent` precedence vs `modes.prompt.agentOrder`; model resolution chain.
- `v1/docs/specless-prompt.md` — `--agent`, `--model`, colon-vs-`--model` precedence on the prompt surface.
- `v1/docs/operator-runbook.md` — `jarvis1 prompt --agent` verification path; cross-link `per-run-agent-override-flag` for `run`/`plan`.
- `v2/docs/v1-behaviors.md` — prompt-mode `--agent` override; seed relationship for cross-mode tracker.
