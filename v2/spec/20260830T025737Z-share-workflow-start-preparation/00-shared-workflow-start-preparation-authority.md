# Shared workflow-start preparation authority

## Problem

`isUnrealizableWorkflowReview` lives in `pipeline-definition.ts` and `WORKFLOW_POSTURE_PRESETS` lives in `pipeline-stage-resolve.ts` while CLI workflow admission resolves preset names from argv separately. Pipeline validation and stage resolution therefore maintain parallel realizability and posture-to-preset tables that a shared preparation caller cannot treat as one contract.

## Decision ledger

- Add `v2/src/commands/workflow-start-preparation.ts` as the sole production owner of base-workflow/review realizability and posture-to-preset realization; rules out leaving those tables in `pipeline-definition.ts` and `pipeline-stage-resolve.ts`.
- `pipeline-definition.ts` admission and `pipeline-stage-resolve.ts` preset-name lookup import the shared owner exports only; rules out re-export shims that preserve duplicate table literals at call sites.
- Preserve the documented posture matrix: pipeline `implement` + `none` stays unrealizable while standalone `implement --review-passes 0` stays CLI-valid; rules out changing either admission contract during extraction.
- Deferred to first consumer: normalized builder input, machine-config stamping, and stale-reset preflight orchestration — pin when the CLI adapter delegates full preparation in subspec 01.

## Task checklist

- Add the shared owner module with realizability and posture-to-preset realization for `intent`, `plan`, and `implement`.
- Route `validatePipelineDefinition` unrealizability checks and `pipeline-stage-resolve` preset-name selection through those exports; leave daemon step assembly otherwise unchanged.
- Add a structural regression beside the shared owner that fails when production tables remain outside it.
- Run `bun run typecheck` and `bun run test:v2` scoped to touched surfaces.

## Acceptance criteria

- [ ] A structural test colocated with `workflow-start-preparation.ts` rejects production workflow/review realizability or posture-to-preset tables outside that module; it fails against the pre-fix `isUnrealizableWorkflowReview` body in `pipeline-definition.ts` and `WORKFLOW_POSTURE_PRESETS` in `pipeline-stage-resolve.ts`, both reachable on main admission and stage-resolution paths.
- [ ] `v2/src/execution/pipeline-definition-validation.test.ts` test `implement under none is unrealizable; light on the same stage validates clean` stays green.
- [ ] `v2/src/execution/pipeline-posture-cli-alignment.test.ts` describe `pipeline posture vs workflow CLI review acceptance` stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — posture-to-preset and realizability authority now live in the shared workflow-start preparation owner; merge-day daemon assembly remains pending migration.
