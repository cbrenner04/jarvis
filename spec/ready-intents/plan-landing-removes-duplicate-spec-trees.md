---
name: plan-landing-removes-duplicate-spec-trees
---

# Plan-tree landing removes duplicate spec directories on the branch

## Problem

Branches that already accumulated multiple timestamped spec trees from pre-fix resumes must not keep orphans that can merge to `main` as unimplemented specs.

## Decisions

- During git-enabled plan-tree landing, when more than one `<targetDir>/*-<name>/` directory exists on the plan branch, keep the newest matching basename (same survivor rule as plan rebuild reuse) and remove the other matching siblings in the same landing commit path; active landing `specPath` / `durablePath` must resolve to that survivor before removal runs.
- Do not remove `<targetDir>` trees whose slug differs from the ready-intent `name`, external `plans/<name>/` artifacts, or the kept matching tree; rules out leaving cleanup to the operator.
- Matching is exact: a directory basename matches only `^\d{8}T\d{6}Z-<name>$` (the `SPEC_TIMESTAMP_PREFIX` shape in `src/commands/cleanup-artifacts.ts` plus the exact ready-intent name), never a `*-<name>` suffix glob; and only trees the plan branch added relative to its base ref count — a same-named tree already on the base (e.g. an earlier plan or archived spec) is never reused or removed.
- External-spec plan landing is unchanged.

## Prerequisites

- A retried plan stage targets the reused landed spec directory instead of minting a new timestamp. (delivered by: plan-rebuild-reuses-landed-spec-dir)

## Primary implementation surface

- `src/execution/publication-landing.ts`

## Acceptance criteria

- [ ] Git-enabled plan landing with multiple sibling `<targetDir>/*-<name>/` directories on the branch ends with exactly one matching tree—the newest matching basename—and deletes the other matching siblings during landing.
- [ ] Landing does not delete non-matching slug directories under `<targetDir>`, external plan trees, or the survivor matching tree.
- [ ] External-spec plan landing performs no duplicate matching-tree removal.
- [ ] Landing never removes a tree whose slug merely ends in `-<name>`, nor a same-named tree already present on the base ref (test).

## Documentation updates

- `docs/spec-guidance.md` — one plan branch carries one timestamped spec tree for its ready-intent, including cleanup on landing when duplicates exist.
- `docs/v1-behaviors.md` — `[harness behavior change]` entry for duplicate plan spec-tree removal at landing.
