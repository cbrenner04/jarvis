---
name: plan-generated-spec-markdown-passes-lint-md
---

# Plan-generated `index.md`/subspecs pass `lint:md`

## Problem

Markdown the plan draft writer emits (`index.md`, subspecs) trips `lint:md`
(observed `MD034` bare URL on the `repo: https://github.com/...` line). The
post-generation `bun run ready` fails at `lint:md`, the draft PR is never
auto-readied, and the operator hand-fixes the markdown — the manual step the
north star eliminates.

## Direction

Make plan-generated spec markdown pass `lint:md` without operator intervention.
Plan weighs: run markdownlint `--fix` autofix on emitted plan files inside the
generate step, vs. shape the draft writer's output to be lint-clean at emit
(e.g. wrap bare URLs). Keep the ready tier's `lint:md` step authoritative — do
not relax or reorder it.

## Out of scope

- Intent fan-out ready-intent markdown (separate behavior).
- Relaxing or reordering `lint:md` in the ready tier.

## Prerequisites

- `lint:md` runs as a step in the full ready tier
- Plan mode generates `index.md` and numbered subspec files
