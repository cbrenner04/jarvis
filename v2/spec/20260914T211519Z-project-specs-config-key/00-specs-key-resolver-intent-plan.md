# 00 — `specs` resolver and intent/plan publication

Intent/plan publication derives its home from `effectivePublishGit` in `v2/src/execution/publication-workflow-steps.ts` (`git !== false && (plan.commit ?? modes.plan.commit ?? true)`). Replace with one exported resolver reading `projects.<key>.specs`. This subspec wires intent/plan only; the pipeline chained stage and implement admission sites, and the default flip to `"external"`, land in subspec 01.

## Decisions

- One exported resolver (project config record + explicit `specs` value → `"external"` | `"repo"` | a validation error) consumed by every spec-home site; rules out per-site copies, which is how the precedence already drifted across three files.
- `specs: "repo"` means the former publish-git=true behavior (plan commit + PR under `targetDir`); `specs: "external"` means the former publish-git=false behavior (external specs home, no commit/PR); rules out re-deriving old semantics implicitly at each call site.
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
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — replace the `git`/`plan.commit`/`modes.plan.commit` table and precedence with the `specs` key; note the default stays `"repo"` pending subspec 01's flip.
- `v2/docs/v1-behaviors.md` — record the knob change (intent/plan; default flip lands in 01).
- `v2/docs/workflow-runner.md` — update the intent/plan effective-publication description (`buildIntentWorkflowSteps`/`buildPlanWorkflowSteps`) to `specs`.
- `v2/docs/spec-guidance.md` — replace the `plan.commit`/`git` references with `specs`.

## Blocker

`bun run test:v2` fails: `v2/src/daemon/pipeline-stage-resolve.test.ts` — "resolves external ready-intent downstream input for chained plan stage" and "resolves external ready-intent downstream input when machine modes.plan.commit is false" (both `expect(result.ok).toBe(true)` receiving `false`). Confirmed non-flaky: reproduces identically on repeated runs, and passes cleanly at the pre-change baseline (verified by stashing this subspec's diff and re-running).

Root cause: these tests exercise the chained "plan" pipeline stage, which gates external ready-intent lookup through `chainedStageEffectivePublishGit` (`v2/src/daemon/pipeline-chained-workflow-deps.ts`, explicitly subspec 01's site) *before* calling `buildPlanWorkflowSteps` (this subspec's site, now routed through the shared `resolveSpecsHome`). No project config satisfies both simultaneously during this subspec alone:
- Legacy `plan.commit`/`modes.plan.commit` (what the tests use today): `chainedStageEffectivePublishGit` still resolves external correctly (untouched), but `resolveSpecsHome` now hard-rejects the legacy key by design (decision: "Present `plan.commit`... is a validation error"), so `buildPlanWorkflowSteps` errors.
- `specs: "external"` (the new key, tried as a fix): `resolveSpecsHome` resolves external correctly, but `chainedStageEffectivePublishGit` doesn't read `specs` at all (untouched, out of this subspec's scope) and defaults to repo, so the pre-`buildPlanWorkflowSteps` admission check (`locateExternalReadyIntentDownstreamInput`) never looks in the external specs home and fails with "never landed" before `buildPlanWorkflowSteps` is even reached.

Both call sites must agree on one resolver to pass this test, but subspec 00's own text scopes `pipeline-chained-workflow-deps.ts` to subspec 01 ("this subspec wires intent/plan only; the pipeline chained stage ... sites ... land in subspec 01"). I can't wire `chainedStageEffectivePublishGit` through `resolveSpecsHome` without doing (part of) subspec 01's work here. Tried: rewriting the two tests' fixtures to `specs: "external"` (same failure, different reason, shown above); confirmed reverted back to original fixtures for this blocker (no test-file changes applied for this file). Six of seven acceptance criteria are satisfied and ticked; the last (full `test:v2`/`test:integration:v2` green) needs either subspec 01's resolver wiring to land alongside this one, or an explicit call on tolerating this pair red until then.

`bun run test:integration:v2` also reports one failure, but it's the pre-existing sandbox-only `EPERM` on `pipeline-verb-stable-routing.sandbox-unrunnable.test.ts`'s Unix-socket bind (known sandbox blindness, unrelated to this change).
