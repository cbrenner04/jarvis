---
name: seed-and-spec-location-management
---

# Rethink where seeds and specs live, given v2 is a long way off

## Problem

The repo splits planning artifacts across `v1/spec/` (shipping implementation) and `v2/spec/`
(planning + work-seeds under `wip-intents/`, plus `ready-intents/` and `completed/`). That split
assumed v2 would arrive soon and absorb the work. **v2 completion is a long way off**, so in
practice almost everything the observer drives is *v1* work routed through *v2* directories:

- Work-seeds for v1 changes are authored under `v2/spec/wip-intents/` and `v2/spec/ready-intents/`.
- Specs that implement v1 changes (touching `v1/`, `shared/`, root config like `biome.json`) get
  drafted under `v2/spec/<ts>/` and archived by `jarvis cleanup` into `v2/spec/completed/`, then
  must be **hand-moved** to `v1/spec/completed/` (see `v1/docs/operator-runbook.md` § End-of-session
  cleanup — the manual stopgap).
- The mental model ("`v2/spec` = v2 planning") is violated: most of `v2/spec` is actually v1 work.

So the recurring manual relocation is a symptom; the root gap is **the seed/spec directory layout
and routing**, which was designed around a v2 timeline that no longer holds.

## Direction

Reconsider where seeds and specs live and how they're routed — from authoring through archival —
given v2 is distant. Shapes for plan to weigh:

- **Route by target.** A spec/seed for v1 work lives and archives under `v1/spec/` from the start;
  only genuine v2 planning lives under `v2/spec/`. (Fixes authoring *and* `jarvis cleanup`'s archival
  destination — subsuming the narrower cleanup-routing symptom.)
- **Single decoupled location.** One top-level seeds/specs tree not tied to v1/v2, with the target
  version a property of the spec rather than its path.
- **Collapse the split** until v2 materially exists, then reintroduce it.

Whatever shape: `jarvis cleanup` must archive a spec to the right place by what it changed (no manual
move), and `jarvis plan`/`intent` must author in the right place from the start.

## Open questions (for plan to decide)

- Authoring routing signal vs archival routing signal — same mechanism (changed files / declared
  target) or two?
- Mixed specs touching both `v1/` and `v2/`: which home wins? (Likely v1, the shipping surface.)
- Migration of the existing `v2/spec/completed/` v1-work specs already accumulated.
- Interaction with `plan.targetDir` config (currently `v1/spec`) — reconcile with wherever this lands.
- Coordinate with the `wip-intents/` → `seeds/` rename ([[rename-wip-intents-dir-to-seeds]]).

## Out of scope

- v2 implementation timeline itself — this is about artifact location while v2 is pending.

## References

- `jarvis cleanup` (archives to `v2/spec/completed/`), `jarvis plan` / `jarvis intent` (authoring
  locations), `plan.targetDir` config.
- `v1/docs/operator-runbook.md` § End-of-session cleanup — the manual relocation stopgap.
- `CLAUDE.md` § "Specs in this repo" — current v1/v2 split conventions to revise.
- Supersedes the narrower cleanup-routes-spec-to-correct-version-completed seed (folded in here).
