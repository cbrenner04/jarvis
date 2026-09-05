# Plan commit decision parity

## Primary implementation surface

Execution-loop: `planSource` publish decision in `v2/src/execution/publication-workflow-steps.ts`.

## Problem

`planSource` sets `git` from `config.plan?.commit ?? true`, ignoring machine-level `modes.plan.commit`, while `intentSource` already falls back to `modes.plan.commit` when project `plan.commit` is unset.

## Prerequisites

- `01-admit-external-plan-ready-intents` (same `planSource` function; land admission slices first).

## Decision ledger

- Use the same effective-commit expression in `planSource` as `intentSource`: project `plan.commit`, then boolean `modes.plan.commit`, then `true`; rules out leaving the plan-only `?? true` split.
- Keep `config.git === false` as the hard disable for git publication in both workflows; rules out diverging git-disable semantics.
- Do not change implement admission's external-publication predicate in this slice; rules out expanding `resolveExternalPlanSpecIdentity` to honor machine config here.

## Tasks

- Align `planSource` git/commit resolution with `intentSource`'s `publishGit` precedence.
- Add regression coverage in `publication-workflow-steps.test.ts` proving machine `modes.plan.commit: false` routes plan output externally when project `plan.commit` is unset.
- Run scoped verification for the touched execution-loop surface.

## Acceptance criteria

- [x] `publication-workflow-steps.test.ts` test `plan commit decision honors machine modes.plan.commit like intent` asserts plan's publish decision falls back to `modes.plan.commit` when project `plan.commit` is unset; it fails against the current plan-only `?? true` split in `planSource`.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- Deferred to `03`–`05`.
