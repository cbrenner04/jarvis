# 00 - Intent default light review

## Scope

- Default the primary `intent` builder to one light review pass when review options are omitted.
- Collapse `intent-reviewed` onto the same builder defaults; no separate legacy composition path.
- Record a v2 behavior change: bare `intent` now matches former `intent-reviewed`; prior zero-pass default is superseded.
- Document operator-visible defaults, breaking-change posture, and `--review-passes 0` opt-out.

## Decisions

- Default omitted `reviewPasses` to `1` in `buildIntentWorkflowSteps`; rules out `?? 0` on the primary preset.
- Default omitted `reviewBehavior` to `light` for **all** intent runs with `passes > 0` in `buildIntentWorkflowSteps`; rules out the builder's `?? "debate"` fallback everywhere on intent (including multi-pass runs with omitted behavior).
- Explicit `reviewPasses: 0` (including `--review-passes 0`) still omits review; rules out making review unskippable.
- Explicit `reviewPasses` / `reviewBehavior` values override defaults; rules out ignoring CLI or caller overrides.
- `buildReviewedIntentWorkflowSteps` delegates to `buildIntentWorkflowSteps` without applying its own defaults; rules out a distinct legacy configuration path.
- Supersedes the split-only-primary `intent` posture from prior work: bare `intent` now matches former `intent-reviewed`; `intent-reviewed` becomes behaviorally redundant (alias/migration hint may need updating).
- Leave `buildPlanWorkflowSteps` defaults unchanged; rules out coupling this change to the plan sibling on the same file seam.
- Sibling `plan-workflow-defaults-to-debate-review` must plan and run only after this spec merges; rules out parallel fan-out on `publication-workflow-steps.ts`.

## Task checklist

- Change intent builder defaults in `v2/src/execution/publication-workflow-steps.ts`.
- Replace reviewed-intent wrapper defaults with a pure delegate.
- Split/rename `"omits review by default and for zero passes"`; update `"builds file and inline seeds with stable PR titles"` and `"selects light or debate review for positive passes"`; add default-on and debate-without-passes coverage.
- Align durable workflow, operator, and v1-behaviors documentation for cross-section consistency.

## Acceptance criteria

- [ ] `intent-workflow-steps.test.ts` `"defaults to one light review pass when review options are omitted"` (new or renamed from `"omits review by default and for zero passes"`) fails against baseline `reviewPasses ?? 0` / `reviewBehavior ?? "debate"` and passes after implementation, asserting two steps with `review` at index 1, `maxCycles: 1`, and `reviewBehavior: "light"`.
- [ ] `intent-workflow-steps.test.ts` `"omits review for explicit zero passes"` (split from the default case above) still yields a one-step split-only workflow for `reviewPasses: 0`.
- [ ] `intent-workflow-steps.test.ts` proves `buildReviewedIntentWorkflowSteps` with no review options produces the same step shape as `buildIntentWorkflowSteps` with no review options.
- [ ] `intent-workflow-steps.test.ts` `"delegates to split-only builder when reviewPasses is 0"` stays green for `buildReviewedIntentWorkflowSteps` after wrapper collapse.
- [ ] `intent-workflow-steps.test.ts` `"selects light or debate review for positive passes"` updated so omitted `reviewBehavior` with positive passes selects light; explicit `reviewBehavior: "debate"` still selects `review-debate`.
- [ ] `intent-workflow-steps.test.ts` proves omitted `reviewPasses` with explicit `reviewBehavior: "debate"` yields one `review-debate` step with `maxCycles: 1`.
- [ ] `intent-workflow-steps.test.ts` `"builds file and inline seeds with stable PR titles"` updated to expect two steps (split + default review) with unchanged PR title and landing assertions.
- [ ] `intent-workflow-steps.test.ts` `"routes committed intent output from canonical seeds before configured targets"`, `"preserves explicit, inline, and non-canonical target routing"`, `"keeps canonical seed output external when git is disabled"`, and `"only resumes a collision owned by the supplied invocation"` stay green.
- [ ] `workflow-runner.test.ts` `"retains exact cardinality for intent preset"` updated for default two-step intent; `"persists reviewed-intent review as a durable snapshot step"`, `"runs reviewed-intent review and landing only in the split workspace"`, `"retries reviewed-intent landing without rerunning review and persists its cause"`, and `"publishes reviewed-intent body summary after review-last landing"` stay green.
- [ ] `v2/docs/workflow-runner.md` has no remaining split-only `intent` vs distinct `intent-reviewed` contradictions; all relevant sections state one light pass by default, `--review-passes 0` opt-out, and explicit overrides.
- [ ] `v2/docs/operator-runbook.md` preset table, canonical examples, and telemetry paragraph are consistent with review-on-by-default intent and document `--review-passes 0` opt-out plus the breaking change for split-only automation.
- [ ] `v2/docs/v1-behaviors.md` intent review bullet and overview text record the new default, opt-out, and prior zero-pass behavior as a v2 consolidation without v1 intent parity claims.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — intent preset defaults, opt-out, overrides, supersession note.
- `v2/docs/operator-runbook.md` — review-on-by-default, `--review-passes 0` opt-out, breaking-change note for split-only scripts.
- `v2/docs/v1-behaviors.md` — v2 consolidation framing; prior zero-pass default; no v1 intent parity claims.
