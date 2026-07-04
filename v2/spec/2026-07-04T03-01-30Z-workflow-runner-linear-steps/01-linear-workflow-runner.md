# Linear workflow runner

v2/src gains a runner that executes an ordered array of steps: each step
binds a behavior (loop primitive), a prompt, and a role, and the runner
loops that step's behavior until its completion condition before advancing
to the next step. Today the only implemented behavior is `write`
([`role-resolution.md`](../../docs/role-resolution.md)); `review-debate` and
`human` land in Phase 6.

Depends on [00 - Step-scoped run identity](./00-step-scoped-run-identity.md)
for per-step attempt history.

## Decisions

- A step's `role` is carried through as an opaque identifier for durable
  identity only. Resolving `role` to concrete agent/model bindings is a
  separate seam (tracked in a sibling intent); this runner takes each step's
  bindings already resolved, the same shape `executeWriteLoop` takes today.
  Deferred to first consumer: role→binding resolution wiring — pin when that
  caller lands.
- A step completes when its loop reaches `complete`; the runner then
  advances to the next step. Any other terminal outcome (`blocked`,
  `contract_miss`, `invocation_failure`) or a soft-stop (`budget-exhausted`,
  `paused`) stops the whole workflow at that step — the runner never skips
  a step or runs steps out of order.
- Resume re-enters at the last incomplete step: the runner walks steps in
  order, using each step's `stepId`-scoped run lookup; the first step whose
  run is not `completed` is the resume point, and that step's own
  loop-boundary resume logic (unchanged from the single-step write loop)
  takes over from there.
- No new workflow-level budget, pause, or abort concept — each step
  inherits the existing per-step `maxIterations`/`signal`/`pauseSignal`
  semantics unchanged.

## Task Checklist

- [ ] `executeWorkflow` (or equivalent) sequences an ordered `steps` array,
      running each step's loop to a terminal/soft-stop outcome before
      advancing.
- [ ] Non-`complete` step outcomes stop the workflow and surface which step
      it stopped on.
- [ ] Resume re-enters at the first non-`completed` step in order.

## Acceptance criteria

- [ ] A two-step array (`write` behavior for both) runs step one to
      `complete`, then runs step two to `complete`, with no operator
      intervention between steps.
- [ ] A step that ends `blocked`, `contract_miss`, or `invocation_failure`
      stops the workflow before any later step runs.
- [ ] Killing mid-second-step and re-invoking the same workflow resumes at
      step two — step one is not re-run and its attempt history is
      unchanged.
- [ ] After a workflow finishes (or is killed mid-run), each step's attempt
      history is independently queryable via the step-scoped run lookup
      from subspec 00.

## Documentation updates

- New `v2/docs/workflow-runner.md`: runner contract (step shape, ordering,
  completion/advance rule, resume rule), cross-linking
  `role-resolution.md` (step binding vocabulary) and `state-store.md`
  (per-step attempt history).
