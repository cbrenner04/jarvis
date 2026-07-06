# Machine profile loader

Add a loader for a new self-contained on-disk shape, `config/machines/<profile>.json`
(`{ memory, models }`, `models` in `AgentModelConfig` shape), addressed by profile name.
Purely additive: no existing consumer switches over yet (that's
[01](./01-migrate-consumers-to-machine-profiles.md)).

## Decisions

- Path resolution: `config/machines/<profileName>.json` relative to the jarvis
  install root (repo root), same `import.meta.dir`-relative pattern already used
  for `data/agent-model-config.json` — rules out a cwd-relative or env-var path.
- `loadAgentModelConfig`'s JSON-validation body is extracted into a new pure
  exported function, `validateAgentModelConfig(jsonData, agents)`, operating on
  already-parsed JSON rather than a file path; `loadAgentModelConfig(filePath, agents)`
  becomes a thin wrapper over it, behavior-unchanged — rules out duplicating the
  per-agent/role validation logic in the new loader.
- Missing or malformed profile file is a hard error (thrown, with profile name and
  resolved path in the message) — rules out silently falling back to an empty
  config, which the existing `~/.jarvis/v2.json` loader does for its (optional)
  `agents`/`memory` keys but is wrong here since the profile file is the sole
  source of role→model bindings.
- `memory` inside a profile document is optional (same semantics as today's
  `~/.jarvis/v2.json` `memory` key: absent means no free-memory floor, default
  settle delay) — reuses `validateMachineConfigMemory` from `machine-config-loader.ts`
  unchanged.
- Settle-delay default (`2000`ms) is deduped into one exported constant,
  `DEFAULT_SETTLE_DELAY_MS`, defined in `machine-profile-loader.ts` (its
  permanent home once [01](./01-migrate-consumers-to-machine-profiles.md)
  retires `machine-config-loader.ts`'s memory handling) and imported from
  there by `validateMachineConfigMemory` — rules out defining it in
  `machine-config-loader.ts` first and relocating it in 01.
- `loadMachineProfileModels`/`validateAgentModelConfig` throw on file-read/JSON-parse
  errors but return a `LoadError` value for content-validation failures (missing
  role/agent coverage) — inherited unchanged from `loadAgentModelConfig`'s existing
  dual-channel error shape, not a new choice; callers must handle both.

## Task Checklist

- [ ] Extract `validateAgentModelConfig(jsonData: unknown, agents): AgentModelConfig | LoadError` in `v2/src/config/agent-model-config.ts`; `loadAgentModelConfig` delegates to it.
- [ ] Add `DEFAULT_SETTLE_DELAY_MS` constant in `v2/src/config/machine-profile-loader.ts`; `machine-config-loader.ts`'s `validateMachineConfigMemory` imports it instead of using the literal `2000`.
- [ ] Add `v2/src/config/machine-profile-loader.ts`:
  - `loadMachineProfileModels(profileName: string, agents: readonly string[]): AgentModelConfig | LoadError`
  - `loadMachineProfileMemory(profileName: string): { minFreeGb: number | undefined; settleDelayMs: number }`
  - both throw a clear error naming the profile and resolved path when the file is missing or JSON-malformed.
- [ ] Add `v2/src/config/machine-profile-loader.test.ts` covering: missing file, malformed JSON, valid file with both `memory` and `models`, `memory` absent, invalid `models` payload (missing required role), path resolves under `config/machines/`.

## Acceptance criteria

- [x] `agent-model-config.test.ts` stays green (`loadAgentModelConfig` behavior unchanged by the extraction).
- [x] `machine-config-loader.test.ts` stays green (`validateMachineConfigMemory` behavior unchanged by the constant dedupe).
- [x] `loadMachineProfileModels("does-not-exist", ["claude"])` throws naming the profile name and the resolved `config/machines/does-not-exist.json` path.
- [x] `loadMachineProfileModels` on a profile file with malformed JSON throws naming the file.
- [x] `loadMachineProfileModels` on a profile file whose `models` value is missing a required role for a requested agent returns a `LoadError` naming the agent and role (delegated to `validateAgentModelConfig`).
- [x] `loadMachineProfileMemory` on a profile file with no `memory` key returns `{ minFreeGb: undefined, settleDelayMs: DEFAULT_SETTLE_DELAY_MS }`.

## Documentation updates

None — purely additive module, no consumer or operator-facing behavior changes yet.
