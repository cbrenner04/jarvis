# 02 — Config and AgentName expansion

## Problem

`AgentName` is a closed union (`"claude" | "codex" | "cursor"`) used as the
key type for `agentOrder` and `patchModels`. Adding opencode means expanding
that union and updating config defaults, validation, the agent factory, and
the `jarvis config set-order` command so opencode is a first-class but
opt-in agent.

## Decisions

- Expand `AgentName` to `"claude" | "codex" | "cursor" | "opencode"`.
- Default `agentOrder` stays `["claude", "codex", "cursor"]`. Opencode is
  **not** in the default order. Users opt in.
- Default `patchModels` gains an `opencode` entry. Its value is set in the
  follow-up spec; for now use a placeholder string that the validator
  accepts but that the user is expected to overwrite. Use an obvious stub so
  it fails loudly if anyone actually runs it.
- `jarvis config set-order` accepts `opencode` in its comma-separated list
  with the same duplicate/unknown rejection rules as today.
- Validation rejects:
  - Unknown agent names anywhere (`agentOrder`, `patchModels`).
  - Missing `patchModels.opencode` only when the config is being
    auto-bootstrapped or freshly validated; legacy configs without
    `patchModels.opencode` should load with the placeholder default
    populated in memory (same legacy-handling pattern as
    `spec/2026-05-11-patch-mode-models/01-patch-model-config.md`).
- The agent factory (wherever agents are instantiated by name today) must
  handle `"opencode"` by constructing `OpencodeAgent` with `model` taken
  from `patchModels.opencode`.

## Behavior

Config type after this subspec:

```ts
type AgentName = "claude" | "codex" | "cursor" | "opencode";

type PatchModels = Record<AgentName, string>;

type Config = {
  version: 1;
  agentOrder: AgentName[];
  maxIterations: number;
  patchModels: PatchModels;
  logServerUrl: string;
  logServerBind: string;
  worktreeSymlinks?: string[];
  projects: Record<string, Project>;
};
```

Default serialized config gains the `opencode` placeholder:

```json
{
  "patchModels": {
    "claude": "haiku",
    "codex": "gpt-5.3-codex",
    "cursor": "Composer 2",
    "opencode": "<old-opencode-provider-placeholder>"
  }
}
```

## Tasks

- [ ] Update `src/agents/types.ts` to add `"opencode"` to `AgentName`.
- [ ] Update `src/config.ts` defaults and validation to require/accept the
      new `patchModels.opencode` key.
- [ ] Update the agent factory (the function that turns an `AgentName` plus
      `patchModels` into an `Agent` instance) to construct `OpencodeAgent`.
- [ ] Update `jarvis config set-order` parser/validator to accept
      `opencode`.
- [ ] Update `jarvis config show` so the default-shape output includes the
      new key.
- [ ] Update existing tests where `AgentName` is exhaustively switched or
      asserted (e.g. test fixtures that enumerate all agents).
- [ ] Add tests for:
      - Auto-bootstrap producing the new `patchModels.opencode` placeholder.
      - Legacy config without `patchModels.opencode` loading with the
        placeholder populated.
      - `set-order claude,opencode` succeeding.
      - `set-order claude,opencode,opencode` failing with a duplicate
        error.
      - `set-order claude,nonsense` failing with an unknown-agent error.

## Acceptance criteria

- `bun run typecheck` passes (exhaustive switches over `AgentName` now also
  handle `"opencode"`).
- `bun test` passes including the new cases.
- `bun run check` passes.
- Running `jarvis config show` on a freshly bootstrapped config includes
  `opencode` in `patchModels` but **not** in `agentOrder`.
- `jarvis run` against a spec with `agentOrder: ["opencode"]` and the
  placeholder model fails with the existing model-configuration exit path,
  not a panic.

## Documentation updates

- None. Subspec 05 handles README/docs updates.
