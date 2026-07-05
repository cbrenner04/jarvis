# 01 - Wire review-debate into workflow runner

Extend `v2/src/execution/workflow-runner.ts` so a step can declare
`behavior: "review-debate"` and the runner dispatches it to
`executeReviewDebate` (subspec 00), alongside today's sole `behavior: "write"`
case. Extend role-preflight validation to cover the four fixed debate roles.

## Decisions

- Runtime `WorkflowStep` retains `behavior` (currently stripped by
  `defineWorkflowStep` as authoring-only metadata) — the runner now needs it
  to dispatch, since a second behavior exists to dispatch to.
- A `review-debate` step declares per-role prompts *and* a per-role `agents`
  fallback order for each of `adversary`, `advocate`, `adjudicator`,
  `actuator` — four independent orders, not one shared `agents` order
  applied uniformly — instead of the single `role` + single `agents` order a
  `write` step uses. This matches subspec 00's per-role-bindings contract:
  the runner resolves each role's `agents` order to bindings for that role
  before calling `executeReviewDebate` — rules out forcing a four-role
  behavior through the single-role, single-order write-step shape.
- `validateWorkflowStepRoles` requires an `(agent, role)` config entry for
  every agent in each of the four roles' `agents` orders, before any durable
  state change — same preflight guarantee `write` steps already get,
  extended to four independent per-role orders instead of one.
- A workflow containing only a `review-debate` step maps its outcome onto
  `WorkflowResult` (`kind: WriteLoopOutcomeKind`, reused as-is — no new kind
  added) as: all configured cycles completing without an unhandled role
  failure (no `final: null` abort, per subspec 00) is `kind: "complete"`; a
  cycle aborting on role failure is `kind: "invocation_failure"`;
  `resumable` is always `false` (no durable resume in this slice, matching
  subspec 00's deferral) — rules out leaving single-step dispatch without
  any outcome contract when the task checklist requires dispatch to work
  today. Multi-step (`write` + `review-debate`) composition semantics remain
  deferred to first consumer.
- This slice enables only programmatic/runtime construction of a
  `review-debate` step (via `defineWorkflowStep`); no YAML/config-file
  authoring path exists yet — consistent with the deferred `workflow-loader.ts`
  support below.
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
      `executeReviewDebate` instead of `executeWriteLoop`, resolving each of
      the step's four per-role `agents` orders to that role's bindings
      before invoking it.
- [ ] `validateWorkflowStepRoles` validates all four roles' `agents` orders
      for a `review-debate` step against `(agent, role)` config (unchanged
      single-`role` check for `write` steps).
- [ ] A single-step `review-debate` workflow that completes all cycles
      without a role-failure abort reports `WorkflowResult.kind: "complete"`
      with `resumable: false`; one that aborts a cycle on role failure
      reports `kind: "invocation_failure"` with `resumable: false`.

## Acceptance criteria

- [ ] `workflow-runner.test.ts` covers a workflow containing a
      `behavior: "review-debate"` step dispatching to `executeReviewDebate`
      with each role's `agents` order resolved to that role's bindings.
- [ ] `workflow-runner.test.ts` covers a `review-debate` step missing an
      `(agent, role)` entry for one of the four debate roles' `agents`
      orders failing `validateWorkflowStepRoles` before any run is created.
- [ ] `workflow-runner.test.ts` covers a single-step `review-debate` workflow
      reporting `kind: "complete"` / `resumable: false` on a clean run and
      `kind: "invocation_failure"` / `resumable: false` when a role
      invocation aborts a cycle.
- [ ] Existing `write`-step dispatch and validation behavior is unchanged
      (`workflow-runner.test.ts` write-step cases stay green).

## Documentation updates

- `v2/docs/workflow-runner.md`: document `review-debate` as a second
  dispatched `behavior`, its four independent per-role `agents` orders and
  validation, its single-step outcome mapping, that `behavior` is no longer
  stripped at authoring time, and that this slice supports only programmatic
  step construction (no `workflow-loader.ts`/YAML authoring yet).
