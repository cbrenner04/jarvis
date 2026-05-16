# 01 — Patch model config

## Problem

Jarvis currently chooses which agent CLI to run but does not choose the model
used by that CLI. In patch mode, the work should be scoped, implementation
oriented, and already directed by a spec. The default models should reflect the
sweet spot between cost and output quality for coding tasks that should not
need heavy reasoning.

Future modes will need different model choices, so the setting must be scoped
to patch mode instead of being a generic per-agent model.

## Decisions

- Add a `patchModels` object to `~/.jarvis/config.json`.
- Defaults:
  - `claude`: `haiku`
  - `codex`: `gpt-5.3-codex`
  - `cursor`: `Composer 2`
- `patchModels` is manual JSON config for now. Do not add `jarvis config`
  commands for editing it in this subspec.
- Existing config files that omit `patchModels` should continue to load by
  applying the defaults in memory.
- Auto-bootstrapped config files should include `patchModels`.
- Values are non-empty strings keyed by known agent names.
- Jarvis should validate config shape and types only. It should not try to
  preflight whether a model is supported by the installed CLI or account.

## Behavior

Extend the config type:

```ts
type PatchModels = Record<AgentName, string>;

type Config = {
  version: 1;
  agentOrder: AgentName[];
  maxIterations: number;
  patchModels: PatchModels;
  projects: Record<string, Project>;
};
```

The default serialized config should become:

```json
{
  "version": 1,
  "agentOrder": ["claude", "codex", "cursor"],
  "maxIterations": 10,
  "patchModels": {
    "claude": "haiku",
    "codex": "gpt-5.3-codex",
    "cursor": "Composer 2"
  },
  "projects": {}
}
```

When loading an older config without `patchModels`, return a config with the
default `patchModels` populated. Do not rewrite the file just because the field
was missing.

Validation should reject:

- `patchModels` values that are not strings.
- Empty or whitespace-only model strings.
- Unknown keys in `patchModels`.
- Missing known-agent keys only when `patchModels` is present.

## Tasks

- [x] Update `src/config.ts` types and defaults to include `patchModels`.
- [x] Update config validation to accept missing legacy `patchModels` by
  defaulting it.
- [x] Add validation for malformed `patchModels`.
- [x] Update config tests for auto-bootstrap, legacy config loading, and invalid
  `patchModels`.

## Acceptance criteria

- New config files include default patch models for `claude`, `codex`, and
  `cursor`.
- Existing config files without `patchModels` still load successfully with
  defaults in the returned object.
- Invalid `patchModels` configs fail with clear errors naming the bad field.
- Commands that load an invalid `patchModels` config exit with the existing
  config-error behavior before invoking any agent.
- `bun run typecheck` passes.
- `bun test` passes.

## Documentation updates

- None. Documentation is handled by `03-documentation.md`.
