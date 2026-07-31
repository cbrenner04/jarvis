# Pipeline intent stage seed path dispatch

## Problem

`resolveIntentStage` passes `PipelineContext.seed` as `seedText`, so `pipeline start --seed`
seeds get frontmatter-derived slugs, empty `paths`, and survive on `main` after landing even
though admission already persists `context.seedPath`.

## Surface

Primary: `v2/src/daemon/pipeline-stage-resolve.ts`. In-scope support:
`pipeline-stage-resolve.test.ts`; optional `intent-split-regression.test.ts` only if the
consumption harness cannot live beside resolution tests without duplicating fixtures.

## Prerequisites

- `PipelineContext` carries optional `seedPath` distinct from inline `seed`
  (`state-store.ts`, `20260731T050915Z-pipeline-context-seed-path-field`).
- `pipeline start --seed` admits `context.seedPath` without inlining file content
  (`pipeline.ts`, `20260731T090156Z-pipeline-start-seed-path-admission`).

## Decisions

- `resolveIntentStage` passes `context.seedPath` as `IntentWorkflowInput.seed` and `context.seed` as `seedText`, never both — rules out always routing admitted file seeds through the inline branch.
- Path-supplied seeds reach `resolveSeed` path branch so slug, name, label, and `paths` match standalone `jarvis run workflow intent --seed <path>` — rules out frontmatter stripping or slug fixes in the text branch.
- Inline `--seed-text` admissions keep today's inline slug/name with `paths: []` and no seed-file deletion — rules out changing the text-branch heuristic or deleting nonexistent paths.
- First workflow stage only; chained stages keep artifact-driven inputs — rules out re-threading admission seed into later stages.
- Out of scope: ready-intent → plan handoff (#2363) and the inline `--seed-text` slug heuristic itself.

## Task checklist

- Branch `resolveIntentStage` on `context.seedPath` vs `context.seed` when building `IntentWorkflowInput`.
- Add a frontmatter-leading seed fixture; assert pipeline first-stage resolution (real builders) and standalone `buildIntentWorkflowSteps` with the same relative `--seed <path>` produce matching slug, name, and label.
- Add landing consumption coverage: resolve first intent stage with `seedPath`, land the built write step, assert the source seed file is absent from the worktree.
- Retain `--seed-text` coverage; add `Mutation checkpoint:` guards that `seedPath` on the text branch or `seedText` on the path branch turns tests RED.
- Update operator and architecture docs listed below; correct `daemon-host.md` first-stage hand-off prose that still claims only `PipelineContext.seed`.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` — frontmatter-leading fixture: pipeline first-stage resolution and standalone `buildIntentWorkflowSteps` with the same `--seed <path>` produce matching slug, name, and label; fails pre-fix; `Mutation checkpoint:` routing `context.seedPath` through `seedText` (yielding a `name-`-prefixed slug) turns the test RED.
- [ ] `pipeline-stage-resolve.test.ts` — after pipeline intent-stage landing via resolved write-step `landing`, the `--seed <path>` source file is absent from the worktree; a surviving seed file with `paths: []` makes the test fail; fails pre-fix; `Mutation checkpoint:` clearing `IntentWorkflowInput.seed` or `landing.inputs.paths` turns the test RED.
- [ ] `pipeline-stage-resolve.test.ts` — `--seed-text` admission still resolves inline slug/name with `paths: []` and records no seed paths for deletion; `Mutation checkpoint:` setting `seedPath` on the text branch turns the test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline start — `--seed <path>` matches standalone intent seed-path behavior including consumption; `--seed-text` is inline-only.
- `v2/docs/workflow-runner.md` — publication landing consumption applies to pipeline-supplied seed paths recorded by first-stage resolution.
- `v2/docs/daemon-host.md` § Seed/artifact hand-off — first-stage input documents `seedPath` vs inline `seed`.
- `v2/docs/v1-behaviors.md` — record pipeline file-seed identity and consumption parity with standalone intent.
