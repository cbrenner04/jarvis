# 02 — Config and AgentName expansion

## Problem

Adding `airproxy` and `copilot` to `AgentName` requires updating the
config schema, validator, defaults, the agent factory, and the
`jarvis config set-order` command — the same surface that subspec 02 of
the prerequisite spec touched for `opencode`.

## Decisions

- Expand `AgentName` to
  `"claude" | "codex" | "cursor" | "opencode" | "airproxy" | "copilot"`.
- Default `agentOrder` stays `["claude", "codex", "cursor"]`. The new
  agents are opt-in.
- Default `patchModels` gains entries from subspec 00:
  - `airproxy`: `"AirProxy/claude-haiku-4.5"`
  - `copilot`: `"github-copilot/claude-opus-4.7"`
- Legacy configs without these keys load with the defaults populated in
  memory (same legacy-handling pattern as
  `spec/patch-mode-models/01-patch-model-config.md`).
- `jarvis config set-order` accepts `airproxy` and `copilot` with the
  existing duplicate/unknown rejection rules.
- The agent factory constructs `AirProxyAgent` and `CopilotAgent` using
  the `model` from `patchModels[<name>]`.

## Behavior

Config type after this subspec:

```ts
type AgentName =
  | "claude"
  | "codex"
  | "cursor"
  | "opencode"
  | "airproxy"
  | "copilot";

type PatchModels = Record<AgentName, string>;
```

Default `patchModels` in a freshly bootstrapped config:

```json
{
  "patchModels": {
    "claude": "haiku",
    "codex": "gpt-5.3-codex",
    "cursor": "Composer 2",
    "opencode": "<old-opencode-provider-placeholder>",
    "airproxy": "AirProxy/claude-haiku-4.5",
    "copilot": "github-copilot/claude-opus-4.7"
  }
}
```

Note: this is also the moment to revisit the `opencode` placeholder from
the prerequisite spec. If reviewers prefer, replace
the old provider placeholder with a concrete default
(e.g. `"AirProxy/claude-haiku-4.5"`) since opencode now has real
provider-named siblings. Decide during this subspec; if you change it,
note the change in `## Decisions` above.

## Tasks

- [ ] Update `src/agents/types.ts` to add `"airproxy"` and `"copilot"` to
      `AgentName`.
- [ ] Update `src/config.ts` defaults and validation for the new
      `patchModels` keys.
- [ ] Update the agent factory to construct `AirProxyAgent` and
      `CopilotAgent`.
- [ ] Update `jarvis config set-order` parser/validator to accept the new
      names.
- [ ] Update `jarvis config show` so the default-shape output includes
      the new keys.
- [ ] Decide whether to replace the `opencode` placeholder model with a
      concrete default and apply that change here if so.
- [ ] Update existing tests where `AgentName` is exhaustively switched or
      asserted.
- [ ] Add tests for:
      - Auto-bootstrap producing the new `patchModels` entries.
      - Legacy config without the new keys loading with defaults
        populated.
      - `set-order claude,airproxy,copilot` succeeding.
      - `set-order claude,airproxy,airproxy` failing with a duplicate
        error.
      - `set-order claude,airproxy,nonsense` failing with an unknown-agent
        error.

## Acceptance criteria

- `bun run typecheck` passes (exhaustive switches over `AgentName` now
  also handle the new names).
- `bun test` passes including the new cases.
- `bun run check` passes.
- Running `jarvis config show` on a freshly bootstrapped config includes
  `airproxy` and `copilot` in `patchModels` but **not** in `agentOrder`.
- `jarvis config set-order claude,airproxy,copilot` records that order
  and `jarvis run` against a spec exercises the agents in that sequence.

## Documentation updates

- None. Subspec 04 handles README/docs updates.
