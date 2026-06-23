---
name: rename-wip-intents-dir-to-seeds
---

# Rename the `wip-intents/` directory to `seeds/`

## Problem

The work-seed directory is called `wip-intents/`, but the artifacts in it are consistently referred
to (in the runbook, conventions, and day-to-day) as **seeds** — and "wip-intent" is a confusing name
(it reads like an in-progress *intent*, which is a different pipeline artifact). The name no longer
matches the vocabulary.

## Direction

Rename `v2/spec/wip-intents/` → `seeds/` (final location depends on
[[seed-and-spec-location-management]]) and update every reference: `CLAUDE.md`/`AGENTS.md`,
`v1/docs/*` (operator-runbook, spec-guidance, etc.), any code that reads the directory path (e.g. the
`jarvis intent` / `plan` flow), and existing seed cross-links. Pure rename + reference update; no
behavior change.

## Open questions

- Sequence with [[seed-and-spec-location-management]]: rename first, or fold the rename into whatever
  new layout that lands? (If the location rethink moves the dir anyway, do the rename as part of it to
  avoid a double move.)
- Keep `ready-intents/` name, or does "intents" terminology get revisited too?

## Out of scope

- Changing what seeds *are* or the pipeline — only the directory name + references.

## References

- `v2/spec/wip-intents/` and all references to it across `CLAUDE.md`, `v1/docs/`, and the
  intent/plan flow.
- [[seed-and-spec-location-management]] — coordinate; likely the same change-set.
