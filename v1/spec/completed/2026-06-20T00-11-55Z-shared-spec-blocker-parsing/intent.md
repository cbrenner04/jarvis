---
name: shared-spec-blocker-parsing
---
# Shared spec and blocker parsing module

**Scope.** Unify `parsePatchSpec`, index checklist, `## Blocker`, acceptance criteria parsing; delete thin `patch/blocker.ts` and `plan/blocker.ts` wrappers.

## Problem

Spec parsing, blocker detection, PR narrative inputs, spec-tree inlining, and related helpers are duplicated across patch, plan, and triage.

## Desired behavior

One shared module owns patch spec parsing, index checklist traversal, `## Blocker` detection, and `## Acceptance criteria` extraction. Patch, plan, and triage import it. Thin mode-specific blocker wrappers are removed.

## Decisions

- Single shared parser module is the source of truth for heading contracts (`## Acceptance criteria`, `## Blocker`). Rules out parallel parsers per mode drifting on heading variants.
- `shared/**` does not import from `v1/**` or `v2/**`. Rules out placing the module under `v1/modes/patch/`.
- Delete `patch/blocker.ts` and `plan/blocker.ts` wrappers rather than re-export shims. Rules out indefinite thin re-export layers.

## Acceptance signals

- Tests prove shared parser handles index checklist, blocker, and acceptance-criteria sections used by patch and plan today.
- Tests prove patch and plan call sites use the shared module; wrapper files are gone.
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: centralized spec parsing ownership.

## Out of scope

- Plan draft structural validation beyond what parsing already enforces (separate intent).
- Changing spec heading contracts.
- Auto-tick on completion.

## Prerequisites
