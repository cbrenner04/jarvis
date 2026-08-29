# Resolve resumed iteration ceiling from injected config

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

After the preceding detached-daemon propagation slice, snapshot-backed daemon resume still reconstructs a missing `iterationCeilingMs` from `join(jarvisHome(), "config.json")`. It can therefore use the operator-home ceiling instead of the daemon's selected injected config. The existing regression uses the same path for both sources and cannot distinguish them.

## Decision ledger

- Resolve an absent snapshot `iterationCeilingMs` with `readIterationCeilingMs(writeLoopBindingSourceDeps.machineConfigPath)`; the existing loader applies its default when that selected file is absent or omits `iterationCeilingMs`, not only when no path is injected. This rules out reconstructing a path from `jarvisHome()`.
- Preserve a persisted snapshot `iterationCeilingMs`; rules out refreshing an already-stamped ceiling from the selected config during resume.
- Add both a distinct-path runtime regression and a static source guard at the daemon resume reconstruction seam; rules out a functional pin whose fixture lets operator-home and injected config collapse to the same path.

## Tasks

- [ ] Change snapshot-backed resume reconstruction in `v2/src/daemon/daemon.ts` to read a missing iteration ceiling through the scoped machine-config dependency.
- [ ] Update `v2/src/daemon/daemon-resume.test.ts` to distinguish operator-home and injected configs, cover the selected loader default, and preserve the persisted-snapshot case.
- [ ] Extend `v2/src/daemon/write-loop-binding-source-guard.test.ts` to reject direct operator-home machine-config construction in daemon resume; use only source mutation checkpoints, with no production test hook.
- [ ] Update the durable documentation listed below after the detached-daemon propagation regression is in place.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-resume.test.ts` — `resume resolves a missing iterationCeilingMs from the injected config`; Keystone checkpoint: the test sets distinct operator-home and injected config ceilings, proves resume uses the injected ceiling, fails against the pre-fix fallback, and carries `// @mutate v2/src/daemon/daemon.ts "iterationCeilingMs: step.iterationCeilingMs ?? readIterationCeilingMs(writeLoopBindingSourceDeps.machineConfigPath)," -> "iterationCeilingMs: step.iterationCeilingMs ?? readIterationCeilingMs(join(jarvisHome(), \"config.json\")),"` inside the test body so restoring baseline semantics turns the regression RED.
- [ ] `v2/src/daemon/daemon-resume.test.ts` test `resume keeps persisted iterationCeilingMs on snapshot steps` stays green with distinct operator-home, selected-config, and persisted ceilings.
- [ ] `v2/src/daemon/daemon-resume.test.ts` proves that a missing snapshot ceiling uses the existing loader default when the selected injected config file is absent or omits `iterationCeilingMs`.
- [ ] `v2/src/daemon/write-loop-binding-source-guard.test.ts` — `daemon resume does not construct a ceiling config path from jarvisHome`; Mutation checkpoint: the test rejects the pre-fix reachable construction and carries `// @mutate v2/src/daemon/daemon.ts "iterationCeilingMs: step.iterationCeilingMs ?? readIterationCeilingMs(writeLoopBindingSourceDeps.machineConfigPath)," -> "iterationCeilingMs: step.iterationCeilingMs ?? readIterationCeilingMs(join(jarvisHome(), \"config.json\")),"` inside the test body so restoring it turns the scoped test RED.
- [ ] `v2/docs/daemon-host.md` documents that snapshot-backed resume preserves a persisted iteration ceiling and resolves a missing ceiling from the daemon's selected injected machine-config path, whose loader default applies when the selected file is absent or omits the ceiling.
- [ ] `v2/docs/write-behavior.md` replaces ambiguous “current machine config” wording with the daemon's selected injected machine-config path, retaining persisted-ceiling precedence and loader-default fallback semantics.
- [ ] `v2/docs/v1-behaviors.md` records the corrected existing resume behavior in the parity baseline, citing `v2/src/daemon/daemon.ts`, `v2/docs/daemon-host.md`, and `v2/docs/write-behavior.md`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — snapshot-backed resume ceiling precedence and injected config source.
- `v2/docs/write-behavior.md` — selected config source, persisted-ceiling precedence, and loader-default fallback.
- `v2/docs/v1-behaviors.md` — corrected resume ceiling behavior in the parity baseline.
