# 00 — `specs` resolver and intent/plan publication

Intent/plan publication derives its home from `effectivePublishGit` in `v2/src/execution/publication-workflow-steps.ts` (`git !== false && (plan.commit ?? modes.plan.commit ?? true)`). Replace with one exported resolver reading `projects.<key>.specs`. This subspec wires intent/plan and the pipeline chained stage (`chainedStageEffectivePublishGit`); implement admission and the default flip to `"external"` land in subspec 01.

## Decisions

- One exported resolver (project config record + explicit `specs` value → `"external"` | `"repo"` | a validation error) consumed by every spec-home site; rules out per-site copies, which is how the precedence already drifted across three files.
- `specs: "repo"` means the former publish-git=true behavior (plan commit + PR under `targetDir`); `specs: "external"` means the former publish-git=false behavior (external specs home, no commit/PR); rules out re-deriving old semantics implicitly at each call site.
- The pipeline chained-stage site (`v2/src/daemon/pipeline-chained-workflow-deps.ts`) routes through the resolver here too, since chained plan admission and `buildPlanWorkflowSteps` must agree once legacy keys are rejected; rules out a red `pipeline-stage-resolve.test.ts` between subspecs.
- Absent `specs` resolves to `"repo"` in this subspec, preserving `effectivePublishGit`'s current default; the flip to `"external"` is subspec 01's, once all four spec-home sites route through the resolver; rules out sites disagreeing on the default across the two-commit split.
- A `specs` value other than `"external"`/`"repo"` is a validation error; rules out coercing unknown strings to the default.
- Present `projects.<key>.plan.commit` or machine `modes.plan.commit` is a validation error whose message names `specs`; rules out silently ignoring or aliasing them.
- `projects.<key>.git` keeps its existing external-worktree local-path-selection role (`v2/src/execution/external-worktree.ts`) untouched; the resolver neither reads nor rejects it; rules out breaking local-path projects that legitimately set `git: false`.
- Legacy-key rejection happens lazily at spec-home resolution (each call site invoking the resolver), not a separate config-load validation pass; rules out adding a new config-load stage.
- `plan.targetDir` stays readable regardless of `specs`; only its use as publication root is gated on `"repo"`; rules out rejecting configs that carry `targetDir` under `"external"`.
- `modes.plan.targetDir` is unrelated and stays out of scope; not rejected.
- Step-level `worktree.git` fields are out of scope; only project/machine config spec-home keys change.

## Acceptance criteria

- [x] A new test with explicit config fixtures asserts the resolver yields `"repo"` when `specs` is absent (old default preserved, pending subspec 01's flip), `"repo"` when `specs: "repo"`, and `"external"` when `specs: "external"`; it fails against the pre-fix code.
- [x] A test asserts a `specs` value other than `"external"`/`"repo"` fails validation with a message naming `specs`; it fails against the pre-fix code.
- [x] Tests assert `plan.commit` and machine `modes.plan.commit` each fail validation with a message containing `specs`; it fails against the pre-fix code.
- [x] Existing `git: false` + `localPath` worktree-root tests (e.g. `workflow-runner-core.test.ts`, `write-loop.test.ts`) stay green — `external-worktree.ts`'s local-path selection is untouched by the resolver.
- [x] `v2/src/execution/publication-workflow-steps.ts` resolves the intent/plan spec home through the resolver, and a test asserts a project without `specs` still publishes in-repo, matching pre-fix behavior.
- [x] Existing `publication-workflow-steps.test.ts` fixtures using `plan.commit` or `git: false` as the spec home are rewritten to `specs`, not deleted.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — replace the `git`/`plan.commit`/`modes.plan.commit` table and precedence with the `specs` key; note the default stays `"repo"` pending subspec 01's flip.
- `v2/docs/v1-behaviors.md` — record the knob change (intent/plan; default flip lands in 01).
- `v2/docs/workflow-runner.md` — update the intent/plan effective-publication description (`buildIntentWorkflowSteps`/`buildPlanWorkflowSteps`) to `specs`.
- `v2/docs/spec-guidance.md` — replace the `plan.commit`/`git` references with `specs`.
