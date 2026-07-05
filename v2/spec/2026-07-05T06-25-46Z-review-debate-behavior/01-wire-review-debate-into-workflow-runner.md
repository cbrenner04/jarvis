# 01 - Wire review-debate into workflow runner

Extend `v2/src/execution/workflow-runner.ts` so a step can declare
`behavior: "review-debate"` and the runner dispatches it to
`executeReviewDebate` (subspec 00), alongside today's sole `behavior: "write"`
case. Extend role-preflight validation to cover the four fixed debate roles.

## Decisions

- Runtime `WorkflowStep` retains `behavior` (currently stripped by
  `defineWorkflowStep` as authoring-only metadata) — the runner now needs it
  to dispatch, since a second behavior exists to dispatch to.
- A `review-debate` step declares per-role prompts for `adversary`,
  `advocate`, `adjudicator`, `actuator` instead of the single `role` a
  `write` step uses — rules out forcing a four-role behavior through the
  single-role write-step shape.
- `validateWorkflowStepRoles` requires an `(agent, role)` config entry for
  all four fixed debate roles, for every agent in a `review-debate` step's
  `agents` order, before any durable state change — same preflight
  guarantee `write` steps already get, extended to four roles instead of one.
- Deferred to first consumer: how a review-debate step's cycle outcome maps
  onto `WorkflowResult.kind`/`resumable` for multi-step (`write` +
  `review-debate`) workflows — pin when a real preset composes both.
- Deferred to first consumer: durable state-store persistence
  (`findRunByProjectBranch` / `commitCompletionBoundary`) and resume for a
  review-debate step — pin when a caller needs mid-cycle resume.
- Deferred to first consumer: `workflow-loader.ts` support for authoring a
  `review-debate` step from a `WorkflowSourceStep` (it currently assumes one
  `role` per step) — pin when a review-debate preset is authored.

## Task checklist

- [ ] `WorkflowStepInput.behavior` accepts `"write" | "review-debate"`.
- [ ] `defineWorkflowStep` keeps `behavior` on the returned runtime step
      instead of stripping it.
- [ ] `executeWorkflow` dispatches a `behavior: "review-debate"` step to
      `executeReviewDebate` instead of `executeWriteLoop`.
- [ ] `validateWorkflowStepRoles` validates all of `adversary`, `advocate`,
      `adjudicator`, `actuator` for a `review-debate` step (unchanged
      single-`role` check for `write` steps).

## Acceptance criteria

- [ ] `workflow-runner.test.ts` covers a workflow containing a
      `behavior: "review-debate"` step dispatching to `executeReviewDebate`.
- [ ] `workflow-runner.test.ts` covers a `review-debate` step missing an
      `(agent, role)` entry for one of the four debate roles failing
      `validateWorkflowStepRoles` before any run is created.
- [ ] Existing `write`-step dispatch and validation behavior is unchanged
      (`workflow-runner.test.ts` write-step cases stay green).

## Documentation updates

- `v2/docs/workflow-runner.md`: document `review-debate` as a second
  dispatched `behavior`, its four-role validation, and that `behavior` is no
  longer stripped at authoring time.
