---
name: v2-config-machine-profile
---

# v2 machine profile config layout

Replace the split `~/.jarvis/v2.json` + global `data/agent-model-config.json` layout with the two-machine model we designed: versioned **models + memory** per profile in the jarvis repo, hot-swappable **agents** in `~/.jarvis/config.json`, profile pointer in the same file.

## Decisions

- **`machineProfile`** lives in `~/.jarvis/config.json` (alongside v1 `projects`). Values: `home` | `work` (open string; no enum hardening). v1 ignores unknown top-level keys.
- **`agents`** (ordered outer fallback chain) lives in **`~/.jarvis/config.json` only** — never in repo machine files. Operator reorders frequently at home without a PR. `jarvis config set-agents` writes here; retire `~/.jarvis/v2.json` entirely.
- **Repo machine profiles** at `config/machines/<profile>.json` — self-contained per machine, **no layering/merge**. Each file holds `memory` and `models` (`AgentModelConfig` shape: `(agent, role) → rungs`). Do not put `agents` in these files.
- **Profile resolution:** read `machineProfile` from `~/.jarvis/config.json` → load `config/machines/<profile>.json` relative to jarvis install root. Missing profile file or missing `machineProfile` is a hard error with a clear message (not silent fallback to v1 defaults).
- **Drop CLI `--agents`** on `jarvis write` / `jarvis run start`. Precedence becomes: config.json `agents` → built-in `DEFAULT_WRITE_AGENTS` when absent.
- **No per-project workflow enablement** — do not add `projects.json` or per-project agent order.
- **Migrate reads:** all v2 loaders (`machine-config-loader`, `loadAgentModelConfig` consumers, memory watermark) follow the new paths. Remove `data/agent-model-config.json` after migration; seed `config/machines/home.json` and `config/machines/work.json` with today's binding content split appropriately (home: full roster; work: codex/cursor-heavy as operator prefers).
- **Docs:** update `v2/docs/agent-model-config.md`, `v2/docs/v2-architecture.md`, `v2/docs/write-behavior.md` for the new layout. Remove any remaining local-model/qwen terminal-fallback prose if still present on `main`.

## Absorbed from shrink plan (operator-decided)

- **Coarse validation messages:** one message per invalid rung — drop the per-field `missing X` / `X must be a string` matrix. Write the new loader's tests **table-driven from day one**; do not port the per-field test matrices from `agent-model-config.test.ts` (585 LOC) / `machine-config-loader.test.ts`, and do not re-prove loader validation through cli.test.ts (one wiring test there).
- cli agent-precedence tests collapse with the `--agents` flag removal (precedence is just config `agents` → `DEFAULT_WRITE_AGENTS`).
- Fold `memory-watermark.ts` reads into the new loader path and dedupe the settle-delay default (currently defined in both machine-config-loader.ts and memory-watermark.ts) — one constant.

## Out of scope

- Per-project workflow gating.
- CLI `--agent`/`--model` single-shot override (deferred).
- Automatic hostname detection of profile (operator sets `machineProfile` explicitly).

## Prerequisites

- `jarvis config set-agents` and machine-config loader exist (`v2.json` today).
- `data/agent-model-config.json` and role→model resolution (`loadAgentModelConfig`, `resolveInvocationBindings`) exist.
- Memory watermark admission reads machine config today.

## Suggested subspec split

1. Repo `config/machines/` schema + seed home/work files; relocate model load path.
2. `machineProfile` + `agents` in `~/.jarvis/config.json`; retire `v2.json`; update `set-agents` / `config show|path`.
3. Drop `--agents` CLI flag; update tests and docs.

## Ordering

06 — after 05; before 07 (preset resolves roles from profiles), 08 (rungs resolve from `config/machines/`), and 09 (shrink rungs live there).
