# 02 — Config and AgentName expansion

## Problem

`AgentName` is a closed union (`"claude" | "codex" | "cursor" | "opencode"`)
used as the key type for `agentOrder` and `patchModels`. Adding aider
means expanding that union and updating config defaults, validation, the
agent factory, and the `jarvis config set-order` command so aider is a
first-class but opt-in agent.

## Decisions

- Expand `AgentName` to
  `"claude" | "codex" | "cursor" | "opencode" | "aider"`.
- Default `agentOrder` is unchanged. Aider is **not** in the default
  order. Users opt in.
- Default `patchModels` gains an `aider` entry. The value is a placeholder
  string (recommend `"<set-aider-model>"`) the validator **accepts at
  config-load time** so existing flows are not broken, but that aider's
  agent factory rejects at **run time** if `agentOrder` actually includes
  `aider` and the value is still the placeholder. The run-time rejection
  must use the existing model-configuration exit path (same path the
  opencode placeholder uses today) so fallback behaves consistently. If
  opencode does not currently behave this way, mirror whatever it does
  rather than inventing a new code path — flag the divergence in the PR
  description.
- `jarvis config set-order` accepts `aider` in its comma-separated list
  with the same duplicate/unknown rejection rules as today.
- Validation rejects:
  - Unknown agent names anywhere (`agentOrder`, `patchModels`).
  - Missing `patchModels.aider` only when the config is being
    auto-bootstrapped or freshly validated; legacy configs without
    `patchModels.aider` should load with the placeholder default populated
    in memory (same legacy-handling pattern used for the opencode
    addition).
- The agent factory must handle `"aider"` by constructing `AiderAgent`
  with `model` taken from `patchModels.aider`.

## Behavior

Config type after this subspec:

```ts
type AgentName = "claude" | "codex" | "cursor" | "opencode" | "aider";

type PatchModels = Record<AgentName, string>;
```

Default serialized config gains the `aider` placeholder:

```json
{
  "patchModels": {
    "claude": "haiku",
    "codex": "gpt-5.3-codex",
    "cursor": "Composer 2",
    "opencode": "<placeholder>",
    "aider": "<local-llm-placeholder>"
  }
}
```

## Tasks

- [ ] Update `src/agents/types.ts` to add `"aider"` to `AgentName`.
- [ ] Update `src/config.ts` defaults and validation to require/accept the
      new `patchModels.aider` key, with legacy-config fill-in.
- [ ] Update the agent factory (the function that turns an `AgentName` plus
      `patchModels` into an `Agent` instance) to construct `AiderAgent`.
- [ ] Update `jarvis config set-order` parser/validator to accept `aider`.
- [ ] Update `jarvis config show` so the default-shape output includes the
      new key.
- [ ] Update existing tests where `AgentName` is exhaustively switched or
      asserted (e.g. test fixtures that enumerate all agents).
- [ ] Add tests for:
      - Auto-bootstrap producing the new `patchModels.aider` placeholder.
      - Legacy config without `patchModels.aider` loading with the
        placeholder populated.
      - `set-order claude,aider` succeeding.
      - `set-order aider,aider` failing with a duplicate error.
      - `set-order claude,nonsense` failing with an unknown-agent error.

## Acceptance criteria

- [ ] `bun run typecheck` passes (exhaustive switches over `AgentName` now
      also handle `"aider"`).
- [ ] `bun test` passes including the new cases.
- [ ] `bun run check` passes.
- [ ] Running `jarvis config show` on a freshly bootstrapped config
      includes `aider` in `patchModels` but **not** in `agentOrder`.
- [ ] `jarvis run` against a spec with `agentOrder: ["aider"]` and the
      placeholder model fails with the existing model-configuration exit
      path, not a panic.

## Documentation updates

- None. Subspec 04 handles README/docs updates.
