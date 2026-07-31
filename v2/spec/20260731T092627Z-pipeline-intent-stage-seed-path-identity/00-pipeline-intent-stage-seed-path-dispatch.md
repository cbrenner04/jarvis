# Pipeline intent stage seed path dispatch

## Problem

`resolveIntentStage` passes `PipelineContext.seed` as `seedText`, so `pipeline start --seed`
seeds get frontmatter-derived slugs, empty `paths`, and the seed queue file is not consumed from
the intent worktree after landing (the operator checkout copy may remain). Admission already
persists `context.seedPath`. `cwd: PipelineContext.cwd` anchoring is unchanged from
`pipeline-stage-resolve-prior-worktree`.

## Surface

Primary: `v2/src/daemon/pipeline-stage-resolve.ts`. In-scope support:
`pipeline-stage-resolve.test.ts` only.

## Prerequisites

- `PipelineContext` carries optional `seedPath` distinct from inline `seed`
  (`state-store.ts`, `20260731T050915Z-pipeline-context-seed-path-field`).
- `pipeline start --seed` admits `context.seedPath` without inlining file content
  (`pipeline.ts`, `20260731T090156Z-pipeline-start-seed-path-admission`).
- Supersedes `pipeline-stage-resolve-prior-worktree` first-stage **seed** routing only;
  `cwd: PipelineContext.cwd` and chained artifact-driven stages are unchanged.

## Decisions

- `resolveIntentStage` passes `context.seedPath` as `IntentWorkflowInput.seed` and `context.seed` as `seedText`, never both — rules out always routing admitted file seeds through the inline branch.
- When both `seedPath` and `seed` are populated, prefer `seedPath` (load-as-stored corrupt rows); admission normally prevents dual fields.
- When neither field is set, omit both at resolution time; `resolveIntentInput` rejects later — rules out a new resolution-time error path.
- Legacy `seed`-only persisted rows (pre-`seedPath`) route through `seedText`; no migrate-on-read — out of scope.
- Pipeline resume with persisted `seedPath` re-resolves the first intent stage with the same dispatch branch.
- Path-supplied seeds reach `resolveSeed` path branch so slug, name, label, and `paths` match standalone `jarvis run workflow intent --seed <path>` — rules out frontmatter stripping or slug fixes in the text branch.
- Consumption parity assumes the same git/worktree preconditions as standalone file-seed intent (`consumeFrom: "worktree"` deletes paths present on the intent worktree).
- Inline `--seed-text` admissions keep today's inline slug/name with `paths: []` and no seed-file deletion — rules out changing the text-branch heuristic or deleting nonexistent paths.
- First workflow stage only; chained stages keep artifact-driven inputs — rules out re-threading admission seed into later stages.
- Out of scope: ready-intent → plan handoff (#2363) and the inline `--seed-text` slug heuristic itself.
- Subspec `## Acceptance criteria` are authoritative for mutation-guard inversion; `intent.md` ACs summarize outcomes only.

## Task checklist

- Branch `resolveIntentStage` on `context.seedPath` vs `context.seed` when building `IntentWorkflowInput`.
- Evolve `"first workflow stage builds with PipelineContext.seed as the seed input"` into path-seed and inline-seed cases (see AC3 preservation).
- Add fixture `v2/spec/seeds/queue-widget-refactor.md` in git-backed test repos: YAML frontmatter `name: queue-widget-refactor` then body `# Operator notes only` (no slug-bearing prose). Assert pipeline first-stage resolution (real builders) and standalone `buildIntentWorkflowSteps` with `--seed v2/spec/seeds/queue-widget-refactor.md` produce matching slug `queue-widget-refactor`, name `queue-widget-refactor`, label `v2/spec/seeds/queue-widget-refactor.md`, non-empty `paths`, and matching `landing.inputs.paths` on the resolved write step; mis-routing `seedPath` through `seedText` must yield an inline slug with a `name-` prefix (e.g. `name-queue-widget-refactor`), turning the test RED.
- Add consumption coverage: git fixture with the seed committed on the base branch; resolve first intent stage with `seedPath` via real builders; land via publication landing on the intent worktree; assert the seed is absent from the **intent worktree** (not admission `cwd`).
- Retain inline-seed coverage per AC3; add `Mutation checkpoint:` guards that `seedPath` on the text branch or `seedText` on the path branch turns tests RED.
- Docs: `daemon-host.md` § Seed/artifact hand-off — replace seed-only first-stage prose with `seedPath` vs inline `seed`; `workflow-runner.md` — first-stage pipeline intent write steps carry `landing.inputs.paths` from admitted `seedPath` same as CLI `--seed`; `v1-behaviors.md` — dispatch and consumption parity bullets; `operator-runbook.md` § Pipeline start — `--seed <path>` matches standalone intent seed-path behavior including consumption, `--seed-text` inline-only.

## Acceptance criteria

- [x] `pipeline-stage-resolve.test.ts` — `v2/spec/seeds/queue-widget-refactor.md` fixture: pipeline first-stage resolution and standalone `buildIntentWorkflowSteps` with the same `--seed v2/spec/seeds/queue-widget-refactor.md` produce matching slug `queue-widget-refactor`, name `queue-widget-refactor`, label `v2/spec/seeds/queue-widget-refactor.md`, non-empty `paths`, and matching `landing.inputs.paths` on the resolved write step; fails pre-fix; `Mutation checkpoint:` routing `context.seedPath` through `seedText` (inline slug with `name-` prefix) turns the test RED.
- [x] `pipeline-stage-resolve.test.ts` — git fixture with seed committed on base branch: after pipeline intent-stage landing via resolved write-step `landing` on the intent worktree, `v2/spec/seeds/queue-widget-refactor.md` is absent from the intent worktree (admission `cwd` copy may remain); a surviving seed with `paths: []` makes the test fail; fails pre-fix; `Mutation checkpoint:` clearing `IntentWorkflowInput.seed` or `landing.inputs.paths` turns the test RED.
- [x] `pipeline-stage-resolve.test.ts` — evolved inline-seed test (successor to `"first workflow stage builds with PipelineContext.seed as the seed input"`) stays green: `--seed-text` admission passes `seedText` only with inline slug/name, `paths: []`, and no seed paths for deletion; `Mutation checkpoint:` setting `seedPath` on the text branch turns the test RED.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline start — `--seed <path>` matches standalone intent seed-path behavior including consumption; `--seed-text` is inline-only.
- `v2/docs/workflow-runner.md` — first-stage pipeline intent write steps carry `landing.inputs.paths` from admitted `seedPath` same as CLI `--seed`.
- `v2/docs/daemon-host.md` § Seed/artifact hand-off — first-stage input documents `seedPath` vs inline `seed` (replacing seed-only prose).
- `v2/docs/v1-behaviors.md` — pipeline file-seed dispatch (`seedPath` → `IntentWorkflowInput.seed`, inline `seed` → `seedText`) and consumption parity with standalone intent.
