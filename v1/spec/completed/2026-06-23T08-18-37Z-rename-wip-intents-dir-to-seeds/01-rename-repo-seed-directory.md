# Rename the repo's own seed directory and meta references

## Problem

The jarvis repo's own raw-seed storage is `v2/spec/wip-intents/`. With the
input path renamed to `seeds/` (subspec 00), rename the on-disk directory to
match and update the live operator/meta references that name it. Content-only;
no code change.

## Decisions

- `git mv v2/spec/wip-intents/` → `v2/spec/seeds/`, preserving every file.
- Update only **live** references: `v1/docs/operator-runbook.md`,
  `v2/docs/v2-vision.md`, `v2/spec/v2-meta-index.md`, and stale `wip-intents/`
  *path/cross-link* references inside seed files moved into `seeds/`.
- The raw seed `rename-wip-intents-dir-to-seeds.md` is evidence: its filename,
  `name:` frontmatter, title, and problem prose keep `wip-intents` verbatim
  (the seed *is about* that name), as does its `[[rename-wip-intents-dir-to-seeds]]`
  wikilink (a slug, not a path — valid in any directory). Only stale path links
  inside seeds are fixed; a seed's self-naming is kept. Rules out treating the
  seed's descriptive name as a reference to scrub.
- Do **not** rewrite historical evidence — `v2/spec/completed/**`, `reports/**`,
  and the in-flight non-completed sibling `v2/spec/2026-06-23T06-01-15Z-route-spec-authoring-by-target/`
  keep their original `wip-intents/` wording (frozen authored-spec evidence; its
  conventions already landed in AGENTS.md). Rules out a churny repo-wide
  find/replace through committed history.
- `CLAUDE.md`/`AGENTS.md` carry no `wip-intents` reference — nothing to update,
  despite the intent listing them in scope.

## Task checklist

- [ ] `git mv v2/spec/wip-intents` to `v2/spec/seeds` (all files retained).
- [ ] Update `v1/docs/operator-runbook.md` references to `v2/spec/seeds/`.
- [ ] Update `v2/docs/v2-vision.md` layout reference (`:24`) to `seeds/`.
- [ ] Update `v2/spec/v2-meta-index.md` reference to `v2/spec/seeds/`.
- [ ] Update stale `wip-intents/` path cross-links inside the moved seed files (e.g. `seed-and-spec-location-management.md`); leave the `rename-wip-intents-dir-to-seeds.md` seed's self-naming verbatim.

## Acceptance criteria

- [x] `v2/spec/wip-intents/` no longer exists; its files are present under `v2/spec/seeds/`.
- [x] `v1/docs/operator-runbook.md`, `v2/docs/v2-vision.md`, and `v2/spec/v2-meta-index.md` name `v2/spec/seeds/`, not `wip-intents/`.
- [x] No `wip-intents` reference remains in `v1/docs/operator-runbook.md`, `v2/docs/v2-vision.md`, or `v2/spec/v2-meta-index.md`.
- [x] No `wip-intents` *path/cross-link* reference remains in files under `v2/spec/seeds/`; the `rename-wip-intents-dir-to-seeds.md` seed's filename, frontmatter, title, problem prose, and `[[rename-wip-intents-dir-to-seeds]]` wikilink are kept verbatim as evidence.
- [x] Files under `v2/spec/completed/`, `reports/`, and the in-flight sibling `v2/spec/2026-06-23T06-01-15Z-route-spec-authoring-by-target/` are unchanged.

## Documentation updates

- `v1/docs/operator-runbook.md`: update the `v2/spec/wip-intents/` references to `seeds/`.
- `v2/docs/v2-vision.md`: update the repo-layout reference (`:24`) from `wip-intents/` to `seeds/`.
- `v2/spec/v2-meta-index.md`: update the `wip-intents/*.md` reference to `seeds/`.
