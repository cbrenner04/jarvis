---
name: route-spec-authoring-by-target
---

# Author seeds and specs in their correct home from the start

## Problem

`jarvis plan` / `jarvis intent` author seeds and v1-implementing specs under `v2/spec/`
(via `plan.targetDir = "v1/spec"` for committed specs, but seeds and the mental model still
sit in `v2/spec/`). Given v2 is a long way off, most artifacts authored there are actually v1
work, so the v1/v2 split misroutes from creation and forces later hand-relocation.

## Direction

**Decided layout: route by target.** A seed/spec for v1 work lives under `v1/spec/` from the
start (seeds and committed specs alike); only genuine v2 planning lives under `v2/spec/`. This is
the operator's chosen shape — do not re-litigate single-decoupled-location or collapse-the-split.

Make authoring write each new artifact to its target-version home from the start with no later
manual move: `jarvis intent` writes seeds/ready-intents under the target's tree, and `jarvis plan`
drafts committed specs there too. Reconcile `plan.targetDir` with this layout (a v1-target project
routes to `v1/spec`; v2 planning to `v2/spec`). For specs touching both v1 and v2 surfaces, v1 (the
shipping surface) wins. Update the conventions that describe the layout (`CLAUDE.md` § "Specs in
this repo", `spec-guidance.md`).

## Out of scope

- Cleanup/archival routing destination (separate behavior).
- Migrating already-accumulated completed specs (separate behavior).
- v2 implementation timeline.

## Prerequisites

