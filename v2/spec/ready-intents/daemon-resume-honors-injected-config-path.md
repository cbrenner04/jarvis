---
name: daemon-resume-honors-injected-config-path
---

# Daemon resume honors the injected machine-config path

Unsplit rationale: The behavior changes only daemon resume reconstruction; its functional pin, structural guard, and durable documentation cover the same module boundary.

## Primary implementation surface

- Daemon resume reconstruction in `v2/src/daemon/`

## Prerequisites

- Daemon write-loop binding resolution receives the active machine-config path through `runWithWriteLoopMachineConfigPath` and `writeLoopBindingSourceDeps.machineConfigPath`.

## Problem

- Snapshot-backed resume falls back to `readIterationCeilingMs(join(jarvisHome(), "config.json"))`, so a scoped daemon invocation can read the operator-home ceiling instead of its injected config.
- The existing resume ceiling test sets the injected path equal to `JARVIS_HOME/config.json`, so it does not distinguish the two sources.

## Decisions

- Resolve a missing snapshot `iterationCeilingMs` from `writeLoopBindingSourceDeps.machineConfigPath`; rules out rebuilding the path from `jarvisHome()`.
- Keep persisted snapshot ceilings authoritative; rules out replacing an already-stamped ceiling with current config.
- Extend the existing config-source guard to reject direct `jarvisHome()` machine-config construction in daemon resume; the pre-fix `v2/src/daemon/daemon.ts` ceiling fallback is reachable evidence for the invariant.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-resume.test.ts` test `resume resolves a missing iterationCeilingMs from the injected config` fails against the pre-fix operator-home fallback and passes when distinct operator-home and injected configs use the injected ceiling; a persisted snapshot ceiling remains unchanged.
- [ ] `v2/src/daemon/write-loop-binding-source-guard.test.ts` — `daemon resume does not construct a ceiling config path from jarvisHome`; Mutation checkpoint: an in-body `// @mutate v2/src/daemon/daemon.ts "iterationCeilingMs: step.iterationCeilingMs ?? readIterationCeilingMs(writeLoopBindingSourceDeps.machineConfigPath)," -> "iterationCeilingMs: step.iterationCeilingMs ?? readIterationCeilingMs(join(jarvisHome(), \"config.json\")),"` directive restores the pre-fix reachable violation and turns the scoped test red.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — document resume fallback resolution from the daemon's injected machine-config path.
- `v2/docs/v1-behaviors.md` — record the corrected existing resume behavior in the parity baseline.
