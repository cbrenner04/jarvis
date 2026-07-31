---
name: pipeline-intent-stage-seed-path-identity
---

# Pipeline intent stage preserves file-seed identity and consumption

## Problem

The first pipeline workflow stage passes `PipelineContext.seed` as `seedText`, so path-supplied
seeds get frontmatter-derived slugs and empty `paths`, breaking branch naming and leaving seed
queue files on `main` after landing.

## Decisions

- `resolveIntentStage` passes `context.seedPath` as `IntentWorkflowInput.seed` and `context.seed` as `seedText`, never both — rules out always routing admitted seeds through the inline-seed branch.
- Path-supplied seeds reach `resolveIntentSeed` path branch so slug, name, label, and `paths` match standalone `jarvis run workflow intent --seed <path>` — rules out frontmatter stripping or slug fixes in the text branch.
- Inline `--seed-text` admissions keep today's inline slug/name with `paths: []` and no seed-file deletion — rules out changing the text-branch heuristic or deleting nonexistent paths.
- Out of scope: ready-intent → plan handoff (#2363) and the inline `--seed-text` slug heuristic itself.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` — frontmatter-leading fixture: pipeline first-stage resolution and standalone `buildIntentWorkflowSteps` with the same `--seed <path>` produce matching slug, name, and label; routing through `seedText` (yielding a `name-`-prefixed slug) makes the test fail.
- [ ] `intent-split-regression.test.ts` or `pipeline-stage-resolve.test.ts` — after a pipeline intent stage lands, the `--seed <path>` source file is absent from the worktree; surviving seed file with `paths: []` makes the test fail.
- [ ] `pipeline-stage-resolve.test.ts` — `--seed-text` admission still resolves inline slug/name with `paths: []` and records no seed paths for deletion; a regression guard fails if path semantics leak into the text branch.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline start — `--seed <path>` matches standalone intent seed-path behavior including consumption; `--seed-text` is inline-only.
- `v2/docs/workflow-runner.md` — publication landing consumption applies to pipeline-supplied seed paths.
- `v2/docs/v1-behaviors.md` — record pipeline file-seed identity and consumption parity with standalone intent.

## Prerequisites

- `PipelineContext` accepts optional project-relative `seedPath` distinct from inline `seed`.
- `pipeline start --seed <path>` admits validated `context.seedPath` without inlining file content.
