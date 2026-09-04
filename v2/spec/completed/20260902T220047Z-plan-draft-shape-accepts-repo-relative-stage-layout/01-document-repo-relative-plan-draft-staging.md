# Document repo-relative plan-draft staging

## Problem

Operator docs describe plan-draft staging as flat or single-nested under `.jarvis-plan-stage/spec/<name>/` only; the accepted repo-relative `targetDir` prefix layout from subspec 00 is undocumented.

## Decision ledger

- Align durable docs with subspec 00 in one docs-only subspec; rules out deferring operator-facing staging semantics to a follow-up PR.
- Authoritative staging shape contract stays in `write-behavior.md`; `workflow-runner.md` cross-links only; rules out duplicating the full contract in recovery docs.
- Subspec 01 owns intent-level harness gates (`typecheck`, `test:v2`, `test:integration:v2`); rules out index-routed completion with orphan intent checkboxes.

## Prerequisites

- Subspec 00 lands repo-relative staging resolution and flattening in `write.ts`.

## Task checklist

- Update `v2/docs/write-behavior.md` **Draft output shape contract**: staging also accepts exactly one repo-relative nested tree under `.jarvis-plan-stage/<targetDir>/<name>/` (e.g. `v2/spec/<name>/`), flattens nested input before normalization, and lands the same durable spec layout as flat or `spec/<name>/` input; update **Harness blocker clearing on redraft** `preserveStage` predicate to include repo-relative-only staging.
- Update `v2/docs/v1-behaviors.md` draft output shape bullet: record v2 additive acceptance of repo-relative prefixes ending in the spec directory, beyond flat-or-`spec/<name>/`.
- Update `v2/docs/workflow-runner.md` **Plan-stage recovery** revalidation paragraph: cross-link `write-behavior.md` for the full accepted staging layouts including repo-relative prefixes.

## Acceptance criteria

- [x] `v2/docs/write-behavior.md` documents repo-relative `targetDir` nested staging acceptance, flatten-before-normalize behavior, and repo-relative-only `preserveStage` preservation.
- [x] `v2/docs/v1-behaviors.md` records plan-draft staging acceptance beyond flat-or-`spec/<name>/` to repo-relative prefixes ending in the spec directory.
- [x] `v2/docs/workflow-runner.md` cross-links `write-behavior.md` for recovery revalidation of accepted staging layouts including repo-relative prefixes.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — repo-relative plan-draft staging shape contract and `preserveStage` predicate.
- `v2/docs/v1-behaviors.md` — v2 additive repo-relative staging acceptance change.
- `v2/docs/workflow-runner.md` — cross-link to authoritative staging contract for recovery revalidation.
