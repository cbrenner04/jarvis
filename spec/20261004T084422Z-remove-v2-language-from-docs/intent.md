---
name: remove-v2-language-from-docs
---

# Docs and behavior-catalog tags stop calling the current engine `v2`

## Problem

After the tree move, prose still says "v2 harness" / "v2 operator runbook", and `v1-behaviors.md` carries ~360 `[v2 …]` tags (`[v2 additive]`, `[v2 behavior change]`, `[v2-only]`, `[v2 divergence]`, …) where `v2` only means "the current engine".

## Decisions

- Drop `v2` from prose, titles, and tags where it means the current engine; `v1` references stay because they name a real frozen generation.
- Plan must decide the replacement tag vocabulary for `v1-behaviors.md` (one mechanical mapping applied to every tag, preserving the distinction each tag carries).
- Keep `v1/` and `v1-behaviors.md` filenames.

## Prerequisites

- Paths already moved so prose edits do not race the move (delivered by: move-v2-to-top-level)

## Acceptance criteria

- [ ] `grep -rn '\bv2\b' docs AGENTS.md README.md` matches only lines that name the retired generation history, pinned by a structural test or guard that fails against current prose.
- [ ] `docs/v1-behaviors.md` has no `[v2 …]` tag; every tag uses the chosen vocabulary.
- [ ] `bun run lint:md` passes.

## Documentation updates

- `AGENTS.md`, `docs/**`, `README.md`, `spec/reliability-brief.md`, `spec/reliability-ledger.md`, `.github/workflows/ci.yml` comments.

## Primary implementation surface

- `docs/**/*.md`, `AGENTS.md`, `README.md`
