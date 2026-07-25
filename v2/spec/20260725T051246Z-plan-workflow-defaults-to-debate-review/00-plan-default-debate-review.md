# 00 - Plan default debate review

## Scope

- Default the primary `plan` builder to one debate review pass when review options are omitted.
- Collapse `plan-reviewed` onto the same builder defaults; keep `plan-reviewed-light` as a behavior-only alias.
- Record a v2 behavior change: bare `plan` now matches former `plan-reviewed`; prior zero-pass default is superseded.
- Document operator-visible defaults, breaking-change posture, and `--review-passes 0` opt-out.
- Pin that default-on plan runs still land the spec tree (no stage-only PR regression).

## Decisions

- Default omitted `reviewPasses` to `1` in `buildPlanWorkflowSteps`; rules out `?? 0` on the primary preset.
- Default omitted `reviewBehavior` to `debate` for plan runs with `passes > 0` in `buildPlanWorkflowSteps`; rules out changing review mode while fixing pass count.
- Explicit `reviewPasses: 0` (including `--review-passes 0`) still omits review; rules out making review unskippable.
- Explicit `reviewPasses` / `reviewBehavior` values override defaults; rules out ignoring CLI or caller overrides.
- `buildReviewedPlanWorkflowSteps` delegates to `buildPlanWorkflowSteps` without applying its own defaults; rules out a distinct legacy configuration path for `plan-reviewed`.
- `buildReviewedPlanLightWorkflowSteps` injects only `reviewBehavior: input.reviewBehavior ?? "light"` when delegating; rules out collapsing `plan-reviewed-light` onto the debate default.
- Supersedes draft-only-primary `plan` posture: bare `plan` now matches former `plan-reviewed`; `plan-reviewed` becomes behaviorally redundant with `plan`.
- Depends on merged `intent-workflow-defaults-to-light-review` and reviewed-plan landing work; rules out re-planning that seam in parallel.

## Task checklist

- Change plan builder default `reviewPasses` in `v2/src/execution/publication-workflow-steps.ts`.
- Replace `buildReviewedPlanWorkflowSteps` wrapper defaults with a pure delegate (mirror `buildReviewedIntentWorkflowSteps`).
- Split/rename plan review composition tests; add default-on, alias-equivalence, and landing regression coverage.
- Align durable workflow, operator, and v1-behaviors documentation for cross-section consistency.

## Acceptance criteria

- [ ] `plan-workflow-steps.test.ts` `"defaults to one debate review pass when review options are omitted"` (new or renamed from the `undefined` branch of `"omits review for reviewPasses=%s"`) fails against baseline `reviewPasses ?? 0` and passes after implementation, asserting two steps with `review-debate` at index 1, `maxCycles: 1`, and `reviewBehavior: "debate"`.
- [ ] `plan-workflow-steps.test.ts` `"omits review for explicit zero passes"` (split from the default case above) still yields a one-step draft-only workflow for `reviewPasses: 0`.
- [ ] `plan-workflow-steps.test.ts` proves `buildReviewedPlanWorkflowSteps` with no review options produces the same step shape as `buildPlanWorkflowSteps` with no review options.
- [ ] `plan-workflow-steps.test.ts` `"delegates zero passes to the draft-only plan workflow"` stays green for `buildReviewedPlanWorkflowSteps` after wrapper collapse (compare against `reviewPasses: 0`, not omitted options).
- [ ] `plan-workflow-steps.test.ts` `"aliases delegate with defaults while explicit options override them"` updated so bare `plan` matches `plan-reviewed` debate shape; `plan-reviewed-light` still selects light; explicit zero passes still draft-only.
- [ ] `plan-workflow-steps.test.ts` proves omitted `reviewPasses` with explicit `reviewBehavior: "light"` yields one light `review` step with `maxCycles: 1`.
- [ ] `plan-workflow-steps.test.ts` proves the default-on review step carries `plan-tree` landing with `stagingDir: ".jarvis-plan-stage"` and stage-scoped verdict/spec context (guards against stage-only PR regression at composition time).
- [ ] `workflow-runner.test.ts` `"lands default plan tree when review passes are omitted"` (new) drives a plan workflow built with omitted `reviewPasses` through debate review to a landed spec tree (durable dir with `index.md`, `intent.md`, and at least one `NN-*.md`; `.jarvis-plan-stage/` consumed); it fails against baseline draft-only `plan` and passes after implementation.
- [ ] `workflow-runner.test.ts` `"lands a reviewed light plan tree with its final verdict"`, `"lands a reviewed debate plan tree with its final empty verdict"`, `"retains exact cardinality for plan preset"`, and `"executeWorkflow plan review dispatch"` stay green.
- [ ] `v2/docs/workflow-runner.md` plan sections state one debate pass by default, `--review-passes 0` opt-out, explicit overrides, and no remaining draft-only `plan` vs distinct `plan-reviewed` contradictions.
- [ ] `v2/docs/operator-runbook.md` preset table, canonical examples, and telemetry copy are consistent with review-on-by-default `plan` and document `--review-passes 0` opt-out plus breaking change for draft-only automation.
- [ ] `v2/docs/v1-behaviors.md` plan review bullet records the new default, opt-out, prior zero-pass v2 behavior, and v1 review-by-default alignment without false v1 parity claims on unrelated surfaces.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan preset defaults, opt-out, overrides, supersession note.
- `v2/docs/operator-runbook.md` — review-on-by-default `plan`, `--review-passes 0` opt-out, breaking-change note for draft-only scripts.
- `v2/docs/v1-behaviors.md` — v2 consolidation framing; prior zero-pass default; v1 review-by-default alignment.
