# 01 — Operator doc prose, vision/architecture renames, and reliability/CI copy

## Problem

Operator-facing markdown still titles and narrates the live engine as `v2` (`v2 operator runbook`, `Jarvis v2 — Architecture`, README/config sections, stale `v2/` path prose). Link targets `docs/v2-architecture.md` and `docs/v2-vision.md` embed `\bv2\b` in paths and titles.

## Decisions

- Rename `docs/v2-architecture.md` → `docs/architecture.md` and `docs/v2-vision.md` → `docs/vision.md`; retitle in-file headings to drop generation branding — rules out keeping `v2-*` filenames while satisfying the intent `grep` corpus.
- Update every committed inbound link to those files under `docs/**`, `AGENTS.md`, `README.md`, `spec/reliability-brief.md`, `spec/reliability-ledger.md`, and operator prompts under `prompts/**` when they cite the old paths — rules out partial renames that leave broken links.
- Scrub `\bv2\b` from prose where it means the live harness (titles, "v2 harness", "v2 workflows", section names like `## v2 vocabulary`) — rules out waiting for the guard subspec to carry the editorial sweep.
- Leave `v1/**` paths and frozen-generation narrative untouched — rules out rewriting historical specs under `v1/spec/`.
- When documenting the orchestration database, prefer `state-store.md` / `orchestrationStorePath()` / `~/.jarvis/state/` wording and avoid the literal filename token `v2.sqlite` in the `grep` corpus — rules out an on-disk DB rename in this docs-only spec.
- In `.github/workflows/ci.yml`, rename human-facing step comments `Test (v2)` → `Test (agent)` (and integration likewise); leave `oven-sh/setup-bun@v2` unchanged — rules out treating action version pins as engine branding.
- `docs/research/**` stays in the sweep because intent `grep` includes all of `docs/` — rules out exempting research markdown from the operator corpus.

## Tasks

- [ ] Rename vision/architecture docs; fix titles and internal cross-links.
- [ ] Sweep `docs/**` (except completed-only archives are already lint-ignored), `AGENTS.md`, `README.md`, `spec/reliability-brief.md`, and `spec/reliability-ledger.md` for live-engine `v2` prose; align `docs/onboarding.md`, `docs/operator-runbook.md`, `docs/coding-standards.md`, and other high-traffic operator docs.
- [ ] Update `.github/workflows/ci.yml` step comments per decisions.
- [ ] Run `bun run reflow:md` only if `lint:md` reports `no-hard-wrap` violations introduced by edits.

## Acceptance criteria

- [x] `grep -rn '\bv2\b' docs AGENTS.md README.md` matches only lines that name retired generation history (tree move, former `v2/` layout, or explicit `jarvis` vs `jarvis1` coexistence); fails against pre-fix `docs/operator-runbook.md` line 1 (`# v2 operator runbook`, reachable on main).
- [x] `test-writing.md` and renamed `architecture.md` / `vision.md` contain no `\bv2\b` tokens outside retired-generation history lines.
- [x] `bun run lint:md` passes.

## Documentation updates

- `docs/**` (including renamed `architecture.md`, `vision.md`)
- `AGENTS.md`
- `README.md`
- `spec/reliability-brief.md`
- `spec/reliability-ledger.md`
- `.github/workflows/ci.yml` (comments only)
- `prompts/**` when they link operator architecture/vision docs
