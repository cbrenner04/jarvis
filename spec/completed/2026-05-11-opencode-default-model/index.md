# Opencode default model and provider/model docs

Replace the `patchModels.opencode` placeholder with a real default and
document opencode's `provider/model` selector in `docs/agents.md`.

## Problem

`spec/2026-05-11-opencode-as-agent/` shipped `patchModels.opencode` with a placeholder
string on the assumption that a follow-up spec would introduce per-provider
agents (AirProxy, github-copilot) as siblings of `opencode` in `AgentName`.
That follow-up was a mistake:
**AirProxy** and **github-copilot** are not agents. They are providers in
opencode's `provider/model` selector. The `opencode` agent already reaches
them through `patchModels.opencode` — for example
`"github-copilot/claude-opus-4.7"` or `"AirProxy/claude-haiku-4.5"`.

The leftover placeholder and the docs note pointing at the now-abandoned
follow-up spec are the only artifacts that need cleaning up.

## Approach

Pick a real default for `patchModels.opencode` and update `docs/agents.md` to
describe the `provider/model` string format so users can pick AirProxy,
github-copilot, or any other opencode-configured provider without a separate
agent type.

No new `AgentName` values. No wrapper agent classes. No factory branches. The
`opencode` agent stays the single surface for everything opencode can reach.

## Subspecs

- [x] [00 — Default model and docs](./00-default-model-and-docs.md)

## Conventions

- Run this spec with `jarvis run spec/2026-05-11-opencode-default-model/index.md`.
- Complete one subspec per iteration.
- If a subspec is blocked, append a `## Blocker` section and stop.

## Non-goals

- Adding `airproxy` or `copilot` (or any other provider name) as an
  `AgentName`. Providers are part of the model string.
- Changing `agentOrder` defaults. `opencode` stays opt-in.
- Wrapping `OpencodeAgent` in per-provider classes.
- Adding provider-specific quota signals. Existing opencode quota detection
  already runs on opencode's output regardless of which provider answered.
