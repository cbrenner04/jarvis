# machineProfile resolved at startup with hard error on missing profile

The active machine profile name (`home`, `work`, or any other operator-chosen
string — open, no enum hardening) is currently hardcoded as `"home"` at two
call sites: `v2/src/execution/workflow-loader.ts` (agent model config for
write-loop steps) and `v2/src/daemon/daemon.ts` (memory-watermark headroom
check and settle delay). Replace both with a resolved value read from
`machineProfile` in `~/.jarvis/config.json`, loading
`config/machines/<profile>.json` via the existing loader
(`v2/src/config/machine-profile-loader.ts`).

## Prerequisites

- [[01-v2-agents-config-moves-to-config-json]] lands first — the resolver reads the same `~/.jarvis/config.json` that `agents` now lives in.

## Decisions

- A missing `machineProfile` key in `~/.jarvis/config.json` is a hard error — no fallback to `"home"` or any other default.
- A `machineProfile` naming a profile whose `config/machines/<profile>.json` file doesn't exist is a hard error — this is already `machine-profile-loader.ts`'s existing behavior (`readMachineProfileDocument` throws `not found`); the resolver doesn't duplicate that check.
- `machineProfile` is an open string (no enum) — any non-empty string is accepted by the resolver; only the profile-file lookup can fail.
- Both call sites keep their existing dependency-injection seams (`deps.machineProfile` on `loadWorkflowSteps`, `deps.hasMemoryHeadroom`/`deps.settleDelayMs` on `createRunControlHandlers`) for tests; only the *default* changes from a literal `"home"` to the resolved value.
- `resolveMachineProfile` reads `~/.jarvis/config.json` via the same path constant introduced in subspec [[01-v2-agents-config-moves-to-config-json]], not a redefinition.
- Operators must set `machineProfile` in `config.json` before this subspec ships — there's no bootstrap default, so the next `jarvis write`/`jarvis run start` hard-fails otherwise.

## Task Checklist

- [ ] Add a `resolveMachineProfile(configPath?)` helper that reads `machineProfile` from `~/.jarvis/config.json` (default path) and throws if the key is absent, not a string, or empty.
- [ ] `workflow-loader.ts`'s `loadWorkflowSteps` defaults `deps.machineProfile` to `resolveMachineProfile()` instead of `"home"`.
- [ ] `daemon.ts`'s `createRunControlHandlers` defaults `hasMemoryHeadroom`/`settleDelayMs` using `resolveMachineProfile()` instead of `"home"`.

## Acceptance criteria

- [ ] A `jarvis write`/`jarvis run start` invocation with no `machineProfile` set in `~/.jarvis/config.json` fails with an error naming the missing key, rather than silently defaulting to a `home` profile.
- [ ] A `jarvis write`/`jarvis run start` invocation with `machineProfile` set to a profile that has no matching `config/machines/<profile>.json` file fails with an error naming the missing profile file.
- [ ] With `machineProfile` set to a valid, existing profile, agent model config and daemon memory-watermark settings load from that profile's `config/machines/<profile>.json`, not a hardcoded `home`.
- [ ] `machineProfile` accepts any non-empty string value (e.g. a profile named `work`), not just `home`.
- [ ] A `jarvis write`/`jarvis run start` invocation with `machineProfile` set to `""` fails with an error naming the missing key, the same as an absent key.

## Documentation updates

- Update `v2/docs/agent-model-config.md` and `v2/docs/daemon-host.md` to describe `machineProfile` as a required `~/.jarvis/config.json` key resolved at startup, replacing the hardcoded `"home"` references.
- Update `v2/docs/v1-behaviors.md`'s daemon memory-watermark entry: the profile is no longer hardcoded `"home"`, it's read from `~/.jarvis/config.json`'s `machineProfile` key, which is a hard-error-if-missing requirement.
