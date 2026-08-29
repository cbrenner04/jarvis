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
- Pin `v2/src/daemon/` against direct `jarvisHome()` config-path construction through the existing config-source guard seam; rules out another daemon-local hardcoded config source.

## Acceptance criteria

- [ ] Snapshot-backed resume with distinct operator-home and injected configs uses the injected config's iteration ceiling, while a persisted snapshot ceiling remains unchanged.
- [ ] No production source under `v2/src/daemon/` constructs a machine-config path from `jarvisHome()`, pinned structurally.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — document resume fallback resolution from the daemon's injected machine-config path.
- `v2/docs/v1-behaviors.md` — record the corrected existing resume behavior in the parity baseline.
