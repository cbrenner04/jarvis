# Workflow runner

v2/src gains a runner that executes an ordered array of steps: each step binds a behavior (loop primitive), a prompt, and a role, and the runner loops that step's behavior until its completion condition before advancing to the next step.

See [`v2-architecture.md`](v2-architecture.md) (orchestration; multi-step workflows, resume) and [`role-resolution.md`](role-resolution.md) (step binding vocabulary) for broader context.

## Execution contract

`executeWorkflow(args: WorkflowRunnerInput)` sequences an ordered `steps` array; each step has `stepId` (unique within the workflow), `role` (opaque identifier for durable step identity), and all parameters of a single [`write-behavior.md`](write-behavior.md) write loop.

For each step in order:
1. Run its write loop (via `executeWriteLoop`) to a terminal outcome.
2. If the outcome is `complete`, advance to the next step.
3. Any other terminal outcome (`blocked`, `contract_miss`, `invocation_failure`) or soft-stop (`budget-exhausted`, `paused`) stops the workflow at that step — no later steps are run.

Return `WorkflowResult` indicates which step produced the stopping outcome, its run ID, total iterations consumed across all steps, and resumability.

## Authoring helper and presets

`defineWorkflowStep(...)` is the authoring helper for one concrete workflow step.
It takes `{ stepId, role, behavior, ... }`, where `behavior` is the closed
vocabulary from [`role-resolution.md`](role-resolution.md#role--behavior-reference).
Today only `behavior: "write"` is valid, so the rest of the input is the full
[`write-behavior.md`](write-behavior.md) loop shape plus per-step loop controls
(`maxIterations`, `signal`, `pauseSignal`). The helper returns the
`WorkflowStep` consumed by `executeWorkflow` and passes those loop-control fields
through unchanged.

`resolveWorkflowPreset(name, steps)` resolves a named preset to a concrete
`WorkflowStep[]` by composing `defineWorkflowStep` once per step position. A
preset fixes only step count and behavior sequence. Callers still supply `stepId`,
`role`, and the rest of the per-step write-loop content for each position, but
omit `behavior` because the preset supplies it.

Current preset surface:

- `write-write`: two steps, `write` then `write`

Validation stays synchronous:

- Unknown preset names throw and include the invalid name.
- Wrong per-position array length for a preset throws before any workflow runs.

## Resume contract

Resume re-enters at the first non-`completed` step in order. The runner walks the `steps` array with each step's `stepId`-scoped run lookup (via `findRunByProjectBranch({ project, branch, stepId })`); the first step whose run is not `completed` is the resume point.

Each step's loop-boundary resume logic (unchanged from the single-step write loop) takes over: an `in-progress` attempt is re-run over a dirty worktree; a `budget-soft-stopped` run resumes with a fresh budget; a terminal run status returns its result idempotently.

Resume assumes the caller re-supplies the identical `steps` array the killed run used (same length, order, and `stepId`s). A divergent array on resume is undefined behavior and out of scope.

## Per-step attempt history

Each step maintains its own durable `(project, branch, stepId)` run independently:
- Distinct `run_id` per step.
- Distinct attempt history queryable via `findRunByProjectBranch({ project, branch, stepId })`.
- `stepId` must be unique within the workflow (enforced at invocation).
- `role` is carried for step identity only and is not persisted in durable state — attempt history identifies steps by `stepId`, not role/binding.

A one-step workflow runs identically to a single-step `executeWriteLoop` invocation (same terminal outcomes, same resume behavior).

## Validation

Before running any step, `executeWorkflow` validates:
- `steps` array is not empty.
- All `stepId` values are unique within the array.

Validation failures raise synchronously before any durable state changes.

## Budget and abort

No new workflow-level budget, pause, or abort concept — each step inherits its own `maxIterations`, `signal` (abort), and `pauseSignal` (pause). Values are per-step-configurable; there is no single shared workflow-level cap.
