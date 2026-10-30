---
name: plan-landing-removes-duplicate-spec-trees
---

# Plan-tree landing removes duplicate spec directories on the branch

## Problem

Branches that already accumulated multiple timestamped spec trees from pre-fix resumes must not keep orphans that can merge to `main` as unimplemented specs.

## Decisions

- During git-enabled plan-tree landing, when more than one `<targetDir>/*-<name>/` directory exists on the plan branch, keep the landing target and remove the other matching trees in the same landing commit path; rules out leaving cleanup to the operator.
- External-spec plan landing is unchanged.

## Prerequisites

- A retried plan stage targets the reused landed spec directory instead of minting a new timestamp. (delivered by: plan-rebuild-reuses-landed-spec-dir)

## Primary implementation surface

- `src/execution/publication-landing.ts`

## Documentation updates

- `docs/spec-guidance.md` — one plan branch carries one timestamped spec tree for its ready-intent, including cleanup on landing when duplicates exist.
- `docs/v1-behaviors.md` — `[harness behavior change]` entry for duplicate plan spec-tree removal at landing.
