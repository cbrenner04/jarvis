# Rename the repo's own seed directory and meta references

## Problem

The jarvis repo's own raw-seed storage is `v2/spec/wip-intents/`. With the
input path renamed to `seeds/` (subspec 00), rename the on-disk directory to
match and update the live operator/meta references that name it. Content-only;
no code change.

## Decisions

- `git mv v2/spec/wip-intents/` → `v2/spec/seeds/`, preserving every file.
- Update only **live** references: `v1/docs/operator-runbook.md`,
  `v2/spec/v2-meta-index.md`, and seed files moved into `seeds/`.
- Do **not** rewrite historical evidence — `v2/spec/completed/**`, other dated
  spec trees, and `reports/**` keep their original `wip-intents/` wording.
  Rules out a churny repo-wide find/replace through committed history.

## Task checklist

- [ ] `git mv v2/spec/wip-intents` to `v2/spec/seeds` (all files retained).
- [ ] Update `v1/docs/operator-runbook.md` references to `v2/spec/seeds/`.
- [ ] Update `v2/spec/v2-meta-index.md` reference to `v2/spec/seeds/`.
- [ ] Update `wip-intents/` cross-links inside the moved seed files (e.g. `seed-and-spec-location-management.md`).

## Acceptance criteria

- [ ] `v2/spec/wip-intents/` no longer exists; its files are present under `v2/spec/seeds/`.
- [ ] `v1/docs/operator-runbook.md` and `v2/spec/v2-meta-index.md` name `v2/spec/seeds/`, not `wip-intents/`.
- [ ] No `wip-intents` reference remains in `v1/docs/operator-runbook.md`, `v2/spec/v2-meta-index.md`, or any file under `v2/spec/seeds/`.
- [ ] Files under `v2/spec/completed/`, other dated `v2/spec/` trees, and `reports/` are unchanged.

## Documentation updates

- `v1/docs/operator-runbook.md`: update the `v2/spec/wip-intents/` references to `seeds/`.
- `v2/spec/v2-meta-index.md`: update the `wip-intents/*.md` reference to `seeds/`.
