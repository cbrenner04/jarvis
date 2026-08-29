---
name: daemon-resume-honors-injected-config-path
---

# Daemon resume reads the injected machine-config path, not a hardcoded one

## Problem

`daemon.ts:671` reads `readIterationCeilingMs(join(jarvisHome(), "config.json"))`, hardcoding a path that exists as `MACHINE_CONFIG_PATH` (`paths.ts:12`) and ignoring the injected `writeLoopBindingSourceDeps.machineConfigPath` every other daemon config read honors (`daemon.ts:421`, `:466`). A resume dispatched under `runWithWriteLoopMachineConfigPath` (`daemon.ts:450`, from `cli.ts:48`) silently takes the iteration ceiling from the real home config instead of the scoped one — the same defect class as the `inertResumeWriteLoopInput` fix in the in-flight parity spec (subspec 02), at a different site.

## Decisions

- The resume path resolves the ceiling from the injected config path; no daemon code joins `jarvisHome()` to a config filename directly. Rules out the hardcoded read.
- A grep-level guard (or the existing config-read seam) pins that `MACHINE_CONFIG_PATH`/injected deps are the only config-path sources in `daemon/`. Rules out the next hardcoded site.

## Acceptance criteria

- [ ] A resume under a scoped machine-config path applies that config's iteration ceiling, pinned by a test that fails against the hardcoded read.
- [ ] No `jarvisHome()`-joined config path remains in `v2/src/daemon/`, pinned structurally.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — config-path resolution on the resume path.
