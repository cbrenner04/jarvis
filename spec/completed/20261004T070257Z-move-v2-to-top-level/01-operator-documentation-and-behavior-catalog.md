# 01 — Operator documentation and behavior catalog for the top-level layout

## Problem

After subspec 00, operators and agents still read `AGENTS.md`, install guidance, and the behavior catalog describing `v2/` layout, `test:v2` scope rules, and `v2/spec` as the jarvis project's planning home.

## Decisions

- Document the `~/.jarvis/config.json` hand edit (`projects.<jarvis-key>.plan.targetDir`: `v2/spec` → `spec`) in `docs/install-and-config.md` only — rules out automating operator machine config in implementation.
- Record the relocation in `docs/v1-behaviors.md` under the harness behavior catalog — rules out a docs-only skip (intent names the catalog).
- `AGENTS.md` and `CLAUDE.md` stay in sync for layout and scoped-test guidance — rules out updating only one root agent file.

## Tasks

- [x] Update `AGENTS.md` (and `CLAUDE.md` if it duplicates layout rules) for `src/`, `spec/`, `docs/`, and scoped scripts `test:agent` / `test:integration`.
- [x] Update `docs/install-and-config.md`: CLI path (`bin/jarvis` → `src/cli.ts`), planning home at `spec/`, and an operator note to re-point an existing jarvis project `plan.targetDir` from `v2/spec` to `spec`.
- [x] Sweep remaining committed `docs/**` and `spec/reliability-*.md` for stale `v2/` references tied to the live engine (not frozen `v1/` history); subspec 00 already rewrites mechanical path literals there.
- [x] Add a `docs/v1-behaviors.md` entry for the top-level engine layout and retired `*:v2` scripts.

## Acceptance criteria

- [x] `docs/install-and-config.md` contains an operator-facing re-point instruction for `plan.targetDir` (`v2/spec` → `spec`); fails against pre-fix install doc (reachable via today's `v2/src/cli.ts` install path prose without re-point guidance).
- [x] `AGENTS.md` describes specs under `spec/` and scoped verification via `test:agent` / `test:integration` (not `test:v2`); fails against pre-fix `AGENTS.md`.
- [x] `docs/v1-behaviors.md` records the move; fails against pre-fix catalog.
- [x] `bun run lint:md` passes.
- [x] `bun run test` passes.

## Documentation updates

- `AGENTS.md`
- `CLAUDE.md` (when it mirrors `AGENTS.md` layout rules)
- `docs/install-and-config.md`
- `docs/v1-behaviors.md`
- Other `docs/**` and `spec/reliability-*.md` as needed for stale `v2/` engine references
