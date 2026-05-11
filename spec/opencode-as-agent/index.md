# Opencode as agent

Add `opencode` as a supported agent CLI in jarvis. This is foundational work
that introduces a new agent module wired into the existing agent abstraction,
without yet exposing the upstream providers that opencode itself can reach
(those are handled in the follow-up spec `airproxy-and-copilot-via-opencode`).

## Problem

Jarvis currently shells out to one of three agent CLIs: `claude`, `codex`, or
`cursor`. On machines where the user authenticates with model providers
through [opencode](https://opencode.ai) — for example a work laptop that
reaches models only via an internal OpenAI-compatible proxy, or a personal
account that pays per-token through opencode's provider system — none of the
existing agent CLIs are usable.

Opencode supports a non-interactive print mode (`opencode run <message>`) that
is shaped enough like the existing agents to be driven the same way. Adding
opencode as a generic CLI agent unblocks any user who has opencode configured
locally, regardless of which underlying provider they use.

This spec only adds the agent. It does not change the default `agentOrder`,
add default `patchModels` entries for opencode, or document specific provider
configurations. The next spec
(`spec/airproxy-and-copilot-via-opencode/`) covers concrete provider wiring
on top of this foundation.

## Approach

Mirror the existing agent modules (`src/agents/claude.ts`, `codex.ts`,
`cursor.ts`). Add a fourth module `src/agents/opencode.ts` that spawns
`opencode run` non-interactively with the prompt passed as message text.
Expand `AgentName` to include `"opencode"`. Update config validation,
defaults, and the agent factory so opencode is selectable but **not** in the
default `agentOrder` — users opt in explicitly via `jarvis config` or by
editing `~/.jarvis/config.json`.

The new permission posture for opencode is configured in the user's
`~/.config/opencode/opencode.json` rather than via a `--dangerously-skip-permissions`
flag, in keeping with the `safe-edits` posture documented in
`spec/permissions/`. The first subspec verifies the opencode permission
schema before code lands.

## Subspecs

- [x] [00 — Verify opencode permission schema](./00-verify-permission-schema.md)
- [x] [01 — Opencode agent module](./01-opencode-agent-module.md)
- [x] [02 — Config and AgentName expansion](./02-config-and-agentname.md)
- [x] [03 — Opencode quota signals](./03-opencode-quota-signals.md)
- [x] [04 — Opencode permission stanza](./04-opencode-permission-stanza.md)
- [x] [05 — Documentation](./05-documentation.md)

## Conventions

- Run this spec with `jarvis run spec/opencode-as-agent/index.md` **once
  opencode is actually wired up**. Until then, the spec author works on it
  directly without jarvis driving.
- Complete one subspec per iteration. Do not bundle.
- If a subspec is blocked, append a `## Blocker` section to that file and
  stop.

## Non-goals

- Adding default `agentOrder` entries for opencode. The user opts in.
- Per-provider configuration of opencode (AirProxy, github-copilot, etc.).
  That is the follow-up spec's job.
- Changing the harness loop, completion semantics, or worktree behavior.
- Touching `claude.ts`, `codex.ts`, or `cursor.ts` beyond what is needed to
  expand the `AgentName` union.
