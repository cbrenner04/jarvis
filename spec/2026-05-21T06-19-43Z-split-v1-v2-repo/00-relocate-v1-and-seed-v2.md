# 00 — Relocate v1-owned trees and seed the v2 skeleton

## Problem

The repository currently mixes the shipping v1 engine, its tests, its specs, and its implementation tooling directly at the repo root. That prevents v2 work from landing alongside v1 without either sharing source trees or creating ambiguous ownership over path-sensitive assets. The first step of the split has to make file ownership explicit and move the current product wholesale into `v1/` without changing behavior.

This slice is the physical relocation step. It defines exactly what moves under `v1/`, what stays at the root, and which current planning files are carved out into `v2/spec/wip-intents/`.

## Decisions

- Treat the change as one big-bang structural move. Do not stage partial root-to-`v1/` migrations across multiple PRs.
- Move the full v1 implementation trees under `v1/` as an allowlist, not a fuzzy “and other files” sweep:
  - `src/` → `v1/src/`
  - `test/` → `v1/test/`
  - `data/` → `v1/data/`
  - `docs/` → `v1/docs/`
  - `scripts/` → `v1/scripts/`
- Treat all behavior-bearing runtime assets inside those trees as first-class moved content, including:
  - `src/modes/patch/rules.md`
  - `src/modes/plan/prompts/*.md`
  - `test/fixtures/**`
  - `test/helpers/**`
  - `data/prices.json`
- `spec/` is split by content rather than copied wholesale:
  - All current non-v2 spec history and planning move under `v1/spec/`, including `spec/completed/**`, `spec/wip-intents/web-interface.txt`, `spec/wip-intents/draft-pr-flip-to-ready-plan.txt`, `spec/wip-intents/still-cant run-non-git-dirs.txt`, and the implementation-history files from this plan tree (`index.md`, `00-relocate-v1-and-seed-v2.md`, `01-root-compatibility-and-tsconfig.md`, `02-docs-specs-and-verification.md`) once this spec has been merged and later implemented from `main`.
  - The current v2 planning material is carved out into `v2/spec/wip-intents/` with exact path moves:
    - `spec/2026-05-21T06-19-43Z-split-v1-v2-repo/intent.md` → `v2/spec/wip-intents/split-v1-v2-repo-intent.md`
    - `spec/wip-intents/v2-vision.md` → `v2/spec/wip-intents/v2-vision.md`
    - `spec/wip-intents/v2.txt` → `v2/spec/wip-intents/v2.txt`
    - `spec/wip-intents/v2-catalog.txt` → `v2/spec/wip-intents/v2-catalog.txt`
    - `spec/wip-intents/v2-prompts.txt` → `v2/spec/wip-intents/v2-prompts.txt`
    - `spec/wip-intents/v2-rename-binary.txt` → `v2/spec/wip-intents/v2-rename-binary.txt`
  - The migration is a relocation, not a duplication step. After the move, those v2 planning files should exist under `v2/spec/wip-intents/` and should no longer remain under `v1/spec/`.
  - The root `spec/` directory should disappear as part of the relocation. After the move, spec content lives only under `v1/spec/` and `v2/spec/`.
- Seed `v2/` only with structure needed for follow-on planning in this step:
  - `v2/spec/`
  - `v2/spec/wip-intents/`
  - no `v2/src/` is required yet unless the implementer needs an empty placeholder to satisfy tooling; if a placeholder is added it must remain inert and pass the unchanged root formatting/lint surface.
  - do not seed a parallel `v2/test/` tree. Future v2 tests live beside the source they cover under `v2/src/`.
- Root-owned paths remain at the top level:
  - `.github/`
  - `.gitignore`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `CODEOWNERS`
  - `README.md`
  - `package.json`
  - `bun.lock`
  - `bunfig.toml`
  - `biome.json`
  - `bin/`
  - shared `node_modules/`
- Root ownership means compatibility or repo glue only. It does not permit leaving the actual v1 implementation behind in root `src/` or root `scripts/`.
- This slice may update imports and runtime path resolution where required by the move, but it must not redesign module boundaries, rename files, or introduce new top-level ownership buckets beyond the ones listed here.

## Tasks

- [ ] Move `src/`, `test/`, `data/`, `docs/`, and `scripts/` under `v1/` without renaming internal files.
- [ ] Move the full non-v2 `spec/` tree under `v1/spec/`, carving out only the exact named v2 planning files into `v2/spec/wip-intents/`.
- [ ] Split this plan tree intentionally: move its `intent.md` into `v2/spec/wip-intents/split-v1-v2-repo-intent.md`, while the implementation-history files from the same tree stay with the v1 spec history under `v1/spec/`.
- [ ] Create the `v2/spec/wip-intents/` skeleton and populate it with the migrated v2 planning material.
- [ ] Update path-sensitive imports and file reads only where the relocation makes them necessary, keeping runtime behavior unchanged.
- [ ] Ensure no behavior-bearing v1 asset remains orphaned at the repo root after the move.

## Documentation updates

- Update any repo-layout documentation touched by this slice so it reflects the new ownership model: root glue, `v1/` engine, and `v2/` planning area.
- Document the exact v2 planning file carveout so future work knows which materials now live under `v2/spec/wip-intents/`.

## Acceptance criteria

- [ ] The repository no longer has root `src/`, `test/`, `data/`, `docs/`, or `scripts/` directories containing the current v1 implementation; their contents live under `v1/` instead.
- [ ] Behavior-bearing non-TypeScript assets that previously shipped with v1, including patch rules, plan prompt markdown, test fixtures/helpers, and `data/prices.json`, moved with the v1 tree rather than remaining at the root.
- [ ] `v1/spec/` contains the current non-v2 spec history and planning content, including `spec/completed/**` and the non-v2 files previously under `spec/wip-intents/`.
- [ ] `v2/spec/wip-intents/` exists and contains the relocated `split-v1-v2-repo-intent.md`, `v2-vision.md`, `v2.txt`, `v2-catalog.txt`, `v2-prompts.txt`, and `v2-rename-binary.txt`, with those files no longer duplicated under `v1/spec/`.
- [ ] The implementation-history files from this spec tree remain available under `v1/spec/` after the split, so the historical record of how the repo was reorganized stays with v1 rather than being mixed into v2 planning.
- [ ] The repo root no longer contains a top-level `spec/` directory after the relocation; specs now live only under `v1/spec/` and `v2/spec/`.
- [ ] No extra package manifest, lockfile, workspace file, or version-local dependency tree was introduced under `v1/` or `v2/`.
- [ ] The split leaves the repo in a structurally consistent state for follow-on work: root compatibility files remain at top level, v1 owns the shipping engine and its history, and v2 owns only the explicitly carved-out planning materials from this step.

## Out of scope

- Renaming the `jarvis` binary to `jarvis1`.
- Introducing Bun workspaces or multiple packages.
- Rewriting prompt text, refactoring module boundaries, or deleting currently tracked v1 files as “unused”.
