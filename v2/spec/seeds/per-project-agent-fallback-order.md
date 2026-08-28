---
name: per-project-agent-fallback-order
---

# V2 reads a per-project agent fallback order, not only the machine-global list

## Problem

The outer agent order is machine-global. `agent-model-config.md` § Storage split says "Per-project variance is **only** the ordered `agents` list", but v2 has no per-project read: `workflow-loader.ts:56` resolves `loadMachineConfig(deps.machineConfigPath) ?? DEFAULT_WRITE_AGENTS`, and `loadMachineConfig` (`v2/src/config/machine-config-loader.ts`) reads only the top-level `agents` key of `~/.jarvis/config.json`. The per-project readers cover `fixCommand`, `readyCommand`, `pipeline`, and `implement.review*` — there is no `projects.<key>.agents` projection.

So the only lever is `jarvis config set-agents`, which reorders agents for *every* project. Projects whose verification toolchains have different agent compatibility cannot coexist: flipping the order to un-wedge one repo silently reorders jarvis-repo runs and everything else.

## Evidence (2026-08-28, #3026)

Machine `agents` `codex,cursor,claude`; pipeline `af881ac0` on `cbrenner04/chess-mvp-yolo` (Xcode/iOS) bound both implement lanes to `codex`, whose sandbox cannot run that toolchain (#3028). No per-project lever existed to prefer cursor/claude for chess without disrupting jarvis-repo runs.

## Decisions

- V2 resolves the workflow agent order as `projects.<key>.agents` when present and valid, else the top-level `agents`, else `DEFAULT_WRITE_AGENTS`. Rules out the machine-global list being the only lever.
- The per-project read lives in `machine-config-loader.ts` alongside the existing `projects.<key>` readers (`fixCommand`, `readyCommand`, `pipeline`), and threads through `workflow-loader.ts`. Rules out a new config surface.
- An absent, empty, or malformed `projects.<key>.agents` falls back to the top-level list. Rules out a bad per-project entry blocking a project's runs.
- Applies to the v2 write/implement binding-assembly path (fresh and rehydrated). Rules out resume reverting to the global list.

## Acceptance criteria

- [ ] `machine-config-loader.test.ts` proves a valid `projects.<key>.agents` resolves to that list, and absent/empty/malformed falls back to the top-level `agents` (then `DEFAULT_WRITE_AGENTS`) — pinned, red against the pre-change loader.
- [ ] A workflow-loader/invocation-path test proves the per-project order reaches binding assembly for a configured project while an unconfigured project keeps the global order.
- [ ] A rehydration test proves the resolved per-project order survives the daemon/JSON boundary.
- [ ] `bun run typecheck` and `bun run test:v2` + `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/agent-model-config.md` — correct § Storage split to describe the now-functional per-project `agents` read, its fallback chain, and interaction with the machine-global list.
- `v2/docs/v1-behaviors.md` — v2 per-project agent order resolution; note v1 behavior is unchanged.
