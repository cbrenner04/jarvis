---
name: intent-generated-ready-intents-pass-lint-md
---

# Intent fan-out emits `lint:md`-clean ready-intents

## Problem

Ready-intents written by `jarvis intent` fan-out trip `lint:md` (observed
`MD012` consecutive blank lines after an empty `## Prerequisites`, `MD018`
missing space after `#` on a wrapped `#499`). The post-generation `bun run
ready` then fails at `lint:md`, the draft PR is never auto-readied, and the
operator hand-fixes the markdown — the manual step the north star eliminates.

## Direction

Make emitted ready-intents pass `lint:md` without operator intervention. Plan
weighs: run markdownlint `--fix` autofix on staged intent files inside the
generate step, vs. extend the existing emit-contract repair (which already
fixes `name:`/`## Prerequisites`) to the common rules (collapse blank runs, fix
ATX spacing). Keep the ready tier's `lint:md` step authoritative — do not relax
or reorder it.

## Out of scope

- Plan-generated `index.md`/subspec markdown (separate behavior).
- Relaxing or reordering `lint:md` in the ready tier.

## Prerequisites

- `lint:md` runs as a step in the full ready tier
- `jarvis intent` fan-out emits ready-intents through an emit-contract repair step
