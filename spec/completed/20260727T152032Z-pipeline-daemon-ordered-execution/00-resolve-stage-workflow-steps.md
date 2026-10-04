# Resolve a pipeline stage into buildable workflow steps

## Problem

- A `pipeline_stages` row plus its pipeline's authored definition give only `{stageId, kind, workflow, review}`.
  Turning that into a `WORKFLOW_PRESET_BUILDERS` call needs pipeline-level `cwd`/config/target-dir/seed and, for
  every stage after the first, the immediately preceding workflow stage's produced spec path. Nothing states
  where that context comes from or how it flows between stages.

## Decisions

- Admission (see subspec 02) carries a `PipelineContext` alongside the validated `PipelineDefinition`:
  `{ cwd: string; configPath?: string; targetDir?: string; projectRegistry?: Record<string, { root: string; origin?: string }>; seed: string }`.
  Held in daemon memory for the pipeline loop's lifetime only — not persisted; restart survival is out of scope
  for this slice (see subspec 02).
- `v2/src/daemon/pipeline-stage-resolve.ts` maps each realizable `(workflow, review)` pair to its
  `WORKFLOW_PRESET_BUILDERS` entry (`v2/src/execution/workflow-presets.ts`): `intent`+`none`→`intent`,
  `intent`+`light`→`intent-reviewed`, `plan`+`none`→`plan`, `plan`+`light`→`plan-reviewed-light`,
  `plan`+`debate`→`plan-reviewed`, `implement`+`light|debate`→ the implement builder with `reviewBehavior` set to
  the stage's own posture — never the project's configured implement review default. `pipeline-definition.ts`'s
  `validatePipelineDefinition`/`isUnrealizableReview` (already rejecting `intent`+`debate` and `implement`+`none`)
  remains the single source of truth for which pairs are realizable; this table only maps realizable pairs to
  builders and is never itself consulted for validity.
- The first workflow stage (by authored position) builds with `seed: pipelineContext.seed`. Every later workflow
  stage builds with its immediately preceding workflow stage's recorded artifact spec path (approval stages are
  skipped when walking back to find it): `readyIntent` for the `plan`/`plan-reviewed*` presets, `specPath` for
  the implement builder.
- The spec path an artifact carries is worktree-relative, matching the existing `Run.specPath` /
  `BuildImplementWorkflowStepsInput.specPath` convention (`v2/src/execution/implement-workflow-steps.ts`); the
  resolver passes it through unchanged into the next stage's builder input rather than re-resolving it to an
  absolute path.
- `reviewPasses` is not yet an authored per-stage knob. The resolver applies a fixed constant (`1`) to every
  built stage rather than reading any project or config default — a documented placeholder, not a silent
  substitution of a project value.
- A stage whose `(workflow, review)` pair has no table entry, or whose builder call itself reports `{ ok: false }`
  (invalid build input), returns a resolution failure (`{ ok: false; error: string }`) instead of throwing or
  falling back to a different preset. Subspec 01 turns that into a recorded stage failure.

## Task checklist

- Add `v2/src/daemon/pipeline-stage-resolve.ts`: posture→preset table, prior-stage artifact hand-off, builder-input
  assembly, resolution result type.
- Add `v2/src/daemon/pipeline-stage-resolve.test.ts`.
- Update `v2/docs/daemon-host.md`.

## Acceptance criteria

- [x] Resolving a pipeline's first workflow stage builds its steps with `PipelineContext.seed` as the seed input
      (not any project-configured seed default); it fails against the pre-change code.
- [x] Resolving a pipeline's second workflow stage builds its steps with the first stage's recorded artifact spec
      path as `readyIntent`/`specPath`, and asserts the two values are equal, proving the hand-off; it fails
      against the pre-change code.
- [x] Each realizable `(workflow, review)` pair resolves to the preset/builder named in Decisions, and the
      implement stage's built steps carry the stage's own posture as `reviewBehavior`; inverting this mapping
      (feeding a project-configured review default instead of the stage's posture) turns the test RED.
- [x] A stage whose pair is unmapped, or whose builder call reports failure, returns a resolution failure rather
      than throwing or silently substituting a different preset; inverting the failure branch (returning
      `ok: true` on builder failure) turns the test RED.
- [x] `bun run typecheck` and `bun run test:v2` pass.
- [x] `v2/docs/daemon-host.md` documents `PipelineContext`, the posture→preset table (naming
      `pipeline-definition.ts` as the sole realizability authority), the seed/artifact hand-off rule, and the
      resolution failure shape.

## Documentation updates

- `v2/docs/daemon-host.md` — pipeline stage resolution: context shape, posture→preset mapping, seed/artifact
  hand-off, resolution failure.
- `v2/docs/v1-behaviors.md` — no change; additive v2-only behavior.
