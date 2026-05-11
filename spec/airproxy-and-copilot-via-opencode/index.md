# AirProxy and Copilot via opencode

Wire two opencode-backed agents into jarvis: `airproxy` (for the internal
OpenAI-compatible proxy used on work machines) and `copilot` (for
`github-copilot` accessed through opencode's provider system). This is the
follow-up to `spec/opencode-as-agent/`, which introduces the generic
opencode agent module.

## Problem

After `spec/opencode-as-agent/` lands, jarvis can run `opencode` as an agent
but only with whatever single `provider/model` is configured under
`patchModels.opencode`. That collapses opencode into one slot in `agentOrder`
and provides no path for quota-driven fallback between providers — e.g.
falling back from AirProxy to Copilot when the proxy is rate-limited, or
swapping a free-tier Copilot model for a paid AirProxy model when Copilot's
quota is exhausted.

The user wants two opencode-backed agents that are distinct in
`agentOrder` and `patchModels`:

- `airproxy` — opencode invoked with an `AirProxy/<model>` selection.
- `copilot` — opencode invoked with a `github-copilot/<model>` selection.

Both share the same underlying opencode binary and the same permission
stanza from the prerequisite spec. They differ only in the model string
passed to opencode.

## Approach

Introduce two new `AgentName` values: `"airproxy"` and `"copilot"`. Each
maps to an agent module that is a thin wrapper around `OpencodeAgent` —
same spawn behavior, same quota detection, different default model and
display name. Update `agentOrder` validation, `patchModels` defaults, the
agent factory, and `jarvis config set-order` to recognize the new names.

No new CLI tooling, no new permission stanzas (the global opencode
permission block from `spec/opencode-as-agent/04` covers both providers),
no new auth flow (opencode handles credentials).

## Prerequisites

This spec depends on **all** of `spec/opencode-as-agent/` being complete.
Specifically:

- `OpencodeAgent` must exist in `src/agents/opencode.ts`.
- `AgentName` must already include `"opencode"`.
- The opencode permission stanza must be installed in
  `~/.config/opencode/opencode.json` on the user's machine.

If those preconditions are not met, agents implementing subspecs here
should `## Blocker`-stop rather than re-implement the opencode foundation.

## Subspecs

- [x] [00 — Decide default models](./00-default-models.md)
- [ ] [01 — AirProxy and Copilot agent modules](./01-agent-modules.md)
- [ ] [02 — Config and AgentName expansion](./02-config-and-agentname.md)
- [ ] [03 — Quota signals refinement](./03-quota-signals-refinement.md)
- [ ] [04 — Documentation](./04-documentation.md)

## Conventions

- Run this spec with `jarvis run spec/airproxy-and-copilot-via-opencode/index.md`
  once the prerequisite spec is fully landed.
- Complete one subspec per iteration. Do not bundle.
- If a subspec is blocked, append a `## Blocker` section and stop.

## Non-goals

- Adding a generic "opencode provider X" agent factory. We support exactly
  two new agents named after the two providers the user actually needs.
  Future additions are separate specs.
- Changing how opencode itself is invoked. The `OpencodeAgent` class from
  the prerequisite spec is the only spawn surface.
- Auth or credential management. Opencode owns that.
- Removing the generic `opencode` agent. It stays in place for users who
  want to control `provider/model` themselves without a provider-named
  agent.
