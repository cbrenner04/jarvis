---
name: jarvis-home-single-seam
---

# All v2 jarvis-home paths resolve through one injectable seam

Every v2 path under `~/.jarvis` is derived independently from `homedir()`:
`v2/src/paths.ts` (daemon socket/pid/log, machine config), `work-boundary-telemetry.ts`
(`DEFAULT_TELEMETRY_SINK_PATH`), `state-store.ts`, `daemon.ts` logs, `plan-workflow-steps.ts`,
`intent-workflow-steps.ts`, `external-worktree.ts`. There is no way to point v2 at a different
jarvis home, so anything that isn't hand-injected a path lands in the operator's real home.

Introduce one seam that resolves the jarvis home (honoring an explicit override, e.g. an env
var read at resolution time, not module load) and route every v2 `~/.jarvis` path through it.
Paths that are today module-level constants become functions so the override is observable
after process start.

Observable: with the override set, every v2 write that would target `~/.jarvis` — telemetry,
machine config read, state store, daemon files, worktree roots — targets the override root
instead; with it unset, behavior is unchanged.

Scope guard: this is the seam plus call-site rewiring. Binding test fixtures to it is a
separate slice.

## Prerequisites

## Documentation updates

- `v2/docs/v2-architecture.md` — the jarvis home seam: how it resolves and how to override it.
