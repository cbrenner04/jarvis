# Migrate consumers to machine profiles

Switch `loadAgentModelConfig`/`resolveInvocationBindings` consumers
(`v2/src/execution/workflow-loader.ts`) and the memory watermark
(`v2/src/daemon/memory-watermark.ts`) from `data/agent-model-config.json` /
`~/.jarvis/v2.json`'s `memory` key to the profile loader from
[00](./00-machine-profile-loader.md). Seed the two profile files and remove the
retired global config.

Which profile name to load for a given machine is out of scope — resolving it
from `~/.jarvis/config.json` is a separate, later intent. This subspec's
consumers take a hardcoded `"home"` profile name as an explicit, named
placeholder until that resolver exists.

## Decisions

- Default/hardcoded profile name for all current call sites is `"home"` (the
  full-roster profile) — preserves today's single-operator behavior exactly
  (today's only config is the full claude+codex roster) until the profile
  resolver intent lands; exposed as an injectable dep on `loadWorkflowSteps`
  and passed explicitly at `daemon.ts` call sites, not silently defaulted deep
  inside `memory-watermark.ts`, so the placeholder is visible at the call site.
- `config/machines/home.json` `models`: today's `data/agent-model-config.json`
  content (claude + codex, unchanged) plus a `cursor` entry, single rung per
  role, using existing `data/prices.json` rows (`Composer 2.5` for
  plan/implement/adversary/advocate/adjudicator, `GPT-5.3 Codex` for actuator) —
  "full roster" names all three agents `agent-model-config.md` already
  documents as adapter identifiers.
- `config/machines/work.json` `models`: codex + cursor only (same rungs as
  `home.json` for those two agents), no `claude` entry — matches the intent's
  "codex/cursor-heavy" framing; a machine using this profile with `claude` in
  its `agents` order would hard-error at load, which is the intended forcing
  function (this profile's roster is deliberately narrower).
- `~/.jarvis/v2.json`'s `memory` key and the code paths that read it
  (`validateMachineConfigMemory`'s call sites in `machine-config-loader.ts`
  outside the memory watermark, `loadMachineConfigMemory`, `readMachineConfigDocument`'s
  `memory` branch) are removed — the profile file's `memory` key is now the sole
  source, `agents` remains the only key `~/.jarvis/v2.json` carries.
- `data/agent-model-config.json` is deleted once `workflow-loader.ts` no longer
  reads it.
- Path/profile-name trust boundary: no validation beyond join-and-read;
  sanitization against attacker-controlled profile names is deferred to the
  profile-name resolver ([[v2-config-json-profile-and-agents]]) — not this
  migration's concern since the name is currently a hardcoded literal.
- A profile missing a required agent (e.g., `work.json` + `claude`) fails at
  the same point in the load path today's missing-agent-in-`data/agent-model-config.json`
  case fails — no new failure-timing behavior introduced by this migration.

## Task Checklist

- [ ] Add `config/machines/home.json` and `config/machines/work.json` per the decisions above.
- [ ] `v2/src/execution/workflow-loader.ts`: replace the `agentModelConfigPath` dep with a `machineProfile` dep (default `"home"`); call `loadMachineProfileModels(deps.machineProfile ?? "home", agents)` instead of `loadAgentModelConfig(AGENT_MODEL_CONFIG_PATH, agents)`.
- [ ] `v2/src/daemon/memory-watermark.ts`: `hasMemoryHeadroom`/`loadSettleDelayMs` take a required `profileName: string` (drop the optional `configPath`); call `loadMachineProfileMemory(profileName)`; remove the module's own settle-delay literal/default (it now comes solely from `loadMachineProfileMemory`'s `DEFAULT_SETTLE_DELAY_MS`).
- [ ] `v2/src/daemon/daemon.ts`: pass `"home"` explicitly at the two now-required-arg call sites (`hasMemoryHeadroom`, `loadSettleDelayMs`).
- [ ] Remove `validateMachineConfigMemory`, `loadMachineConfigMemory`, and the `memory` handling branch from `v2/src/config/machine-config-loader.ts` (the exported `DEFAULT_SETTLE_DELAY_MS` already lives in `machine-profile-loader.ts` per [00](./00-machine-profile-loader.md); no relocation needed here).
- [ ] Delete `data/agent-model-config.json`.
- [ ] Update `machine-config-loader.test.ts` to drop the removed `loadMachineConfigMemory` describe block; move equivalent coverage to `machine-profile-loader.test.ts` if not already covered there.
- [ ] Update `memory-watermark.test.ts` and `workflow-loader.test.ts` call sites for the new required/renamed params.
- [ ] Add a fixture-diff test asserting `loadMachineProfileModels("home", ["claude", "codex"])` produces bindings equivalent to the pre-migration `loadAgentModelConfig(AGENT_MODEL_CONFIG_PATH, ["claude", "codex"])` output.

## Acceptance criteria

- [x] A workflow step for an agent not present in the active profile's `models` fails load the same way missing coverage in `data/agent-model-config.json` did before this migration (hard error naming the agent and role).
- [x] Daemon memory-watermark admission reads free-memory floor and settle delay from `config/machines/home.json`, not `~/.jarvis/v2.json`.
- [x] `~/.jarvis/v2.json` with a `memory` key present is ignored (no longer read) — only `agents` is honored from that file.
- [x] `data/agent-model-config.json` no longer exists in the repo.
- [x] `config/machines/work.json`'s `models` has no `claude` entry; loading it with `agents` containing `claude` for any executable role is a hard error.
- [x] `config/machines/home.json`'s claude and codex role→model bindings produce identical resolved invocation bindings to today's `data/agent-model-config.json` for the same agents/roles (no silent value drift from hand-transcription).
- [x] `memory-watermark.ts` carries no surviving settle-delay literal/default of its own — its only source is `loadMachineProfileMemory`.
- [x] A repo-wide search finds no remaining references to `AGENT_MODEL_CONFIG_PATH` or the string `data/agent-model-config.json` after this subspec lands.
- [x] A repo-wide search finds no remaining code path reading `~/.jarvis/v2.json`'s `memory` key.

## Documentation updates

- Update `v2/docs/agent-model-config.md`: "Storage split" and "Decisions" pins —
  on-disk filename moves from `data/agent-model-config.json` to
  `config/machines/<profile>.json`, loader is `machine-profile-loader.ts`, note
  the two seeded profiles.
- Update `v2/docs/v2-architecture.md`: machine-config references (lines
  documenting the `agent-model-config.md` pointer and the shipped
  `jarvis config` CLI surface) note that role→model bindings and memory
  tuning now live in a repo-committed per-profile file, not the global data
  file; `~/.jarvis/v2.json` is agent-order-only.
- Update `v2/docs/v1-behaviors.md`: memory watermark admission's config source
  changes from `~/.jarvis/v2.json` to the active machine profile file (behavior
  change to existing v2 functionality, per repo doc-update rule).
- Before merge, confirm these three docs are the complete set required by
  `v2/docs/documentation-standard.md` for this change; add any doc the standard
  requires that isn't already listed.
