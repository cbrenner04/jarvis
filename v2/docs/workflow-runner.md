# Workflow runner

v2/src gains a runner that executes an ordered array of steps: each step binds a behavior (loop primitive), a prompt, and a role, and the runner loops that step's behavior until its completion condition before advancing to the next step.

See [`v2-architecture.md`](v2-architecture.md) (orchestration; multi-step workflows, resume) and [`role-resolution.md`](role-resolution.md) (step binding vocabulary) for broader context.

## Execution contract

`executeWorkflow(args: WorkflowRunnerInput)` sequences an ordered `steps`
array. Each step carries `stepId` (unique within the workflow), `role` (the
workflow-source validation key, checked against the current config before
execution), its own `agents` order and `agentModelConfig`, all parameters of a
single [`write-behavior.md`](write-behavior.md) write loop (minus `bindings`),
and an optional `createBinding` test seam.

After validation succeeds, `executeWorkflow` derives each pending step's
execution-time `bindings` from `role`/`agents`/`agentModelConfig` via the
two-axis resolution in [`agent-model-config.md`](agent-model-config.md), then
passes the resulting write-loop input to `executeWriteLoop`.

For the supported `write-write` preset, resolution happens per step when the
runner reaches it. The runner does not precompute one shared binding chain or
reuse step one's resolved bindings for step two, even when both positions use
the same `implement` role and loaded project agent/model config.

Within one step, the resolved binding chain is the loaded step `agents` order
flattened with each agent's configured rungs for that `role`. Quota on an
earlier binding can therefore fall through across both the current agent's rung
list and a later configured agent binding before the step succeeds.

For each `write` step in order:
1. Run its write loop (via `executeWriteLoop`) to a terminal outcome.
2. If the outcome is `complete`, advance to the next step.
3. Any other terminal outcome (`blocked`, `contract_miss`, `invocation_failure`) or soft-stop (`budget-exhausted`, `paused`) stops the workflow at that step — no later steps are run.

A `human` step (see [`role-resolution.md`](role-resolution.md#role--behavior-reference))
dispatches to a separate path that never calls `executeWriteLoop`: the runner
creates or loads that step's `(project, branch, stepId)` run row and sets its
status to `awaiting-human` directly via the state store, then stops the
workflow — `executeWorkflow` returns `WorkflowResult.kind === "awaiting-human"`.
A human step has no attempt/outcome history and no worktree of its own — its
run identity is `(project, branch)` carried on the step itself, not derived
from a `write-behavior.md` worktree. Reaching a human step appends no
`## Blocker` section to any spec file; that helper is contract-miss-specific
write-loop output, not a human-review signal. A human step whose run is
already `completed` (via decision-gated resume) is treated like a completed
write step: the workflow advances past it with no new work.

In the supported `write-write` composition, step two begins only after step one
reaches `complete`. Workflow success means both step-local write loops
completed, not just step one.

Return `WorkflowResult` indicates which step produced the stopping outcome
(`awaiting-human` included), its run ID, total iterations consumed across all
steps, and resumability.

Each step run also persists the workflow invocation snapshot that launched it:
one `invocationId` plus the authored `steps[]` metadata (`stepId`, `role`,
order). Daemon/TUI consumers read that snapshot back from daemon `list` rows as
per-step progress in authored order, without reconstructing future steps from
durable attempt history alone. See [`daemon-host.md`](daemon-host.md#workflow-snapshots-on-list-rows).

## Authoring helper and presets

`defineWorkflowStep(...)` is the authoring helper for one concrete workflow step.
`WorkflowStepInput` (identical in shape to the runtime `WorkflowStep`) is a
discriminated union on `behavior`:

- `behavior: "write"` — `{ stepId, role, ... }`, the full
  [`write-behavior.md`](write-behavior.md) loop shape plus per-step loop
  controls (`maxIterations`, `signal`, `pauseSignal`). Workflow infrastructure
  such as `stateStore` and `logSink` is not part of the public step contract;
  the runner normalizes those once at workflow scope.
- `behavior: "human"` — `{ stepId, project, branch }` only. It carries none of
  the write-loop-only fields (`role`, `agents`, `stepRules`,
  `agentModelConfig`, `expectedArtifactPath`) and no `worktree` — see
  [Execution contract](#execution-contract) above.

The helper returns the `WorkflowStep` consumed by `executeWorkflow`, passing
loop-control fields through unchanged for `write` steps.

`resolveWorkflowPreset(name, steps)` validates a named preset's fixed step count
and returns a `WorkflowStep[]`. Callers supply `stepId`, `role`, and the rest of
the per-step write-loop content for each position, omitting `behavior` (the
preset supplies `"write"` per position until the runner dispatches on behavior).

Current preset surface:

- `write-write`: two steps

Validation stays synchronous:

- Unknown preset names throw and include the invalid name.
- Wrong per-position array length for a preset throws before any workflow runs.

## Resume contract

Resume replays the supplied `steps` array from the beginning on each
invocation, after the runner revalidates the whole array against the
resume-time config (see [Validation](#validation) below). The runner does not
do a separate pre-pass to locate a resume point. Instead, each step re-enters
through its own `stepId`-scoped run lookup (via
`findRunByProjectBranch({ project, branch, stepId })`): a step whose run is
already `completed` returns its stored result idempotently with no new work
and no binding resolution, and the first non-completed step becomes the first
step that performs fresh execution. A `human` step re-entered before its
decision lands re-converges to `awaiting-human` idempotently (same status,
same run row) rather than performing fresh execution.

The step-level loop-boundary resume rules are unchanged from the single-step
write loop: an `in-progress` attempt is re-run over a dirty worktree; a
`budget-soft-stopped` run resumes with a fresh budget; a terminal run status
returns its stored result idempotently.

Resume assumes the caller re-supplies the identical `steps` array the killed run used (same length, order, and `stepId`s). A divergent array on resume is undefined behavior and out of scope.

## Per-step attempt history

Each step maintains its own durable `(project, branch, stepId)` run independently:
- Distinct `run_id` per step.
- Distinct attempt history queryable via `findRunByProjectBranch({ project, branch, stepId })`.
- `stepId` must be unique within the workflow (enforced at invocation).
- `role` is the workflow-source validation key for the step but is not persisted in durable state — attempt history identifies steps by `stepId`, not role/binding.

A one-step workflow runs identically to a single-step `executeWriteLoop` invocation (same terminal outcomes, same resume behavior).

## Validation

Before running any step, `executeWorkflow` validates:
- `steps` array is not empty.
- All `stepId` values are unique within the array.
- For every step and every agent in that step's `agents` order, that step's
  `agentModelConfig` contains an own binding entry for the step's `role`.

Workflow-source role misses are aggregated and reported as `(stepId, role,
agent)` tuples in one synchronous failure. Inherited object properties do not
count as bindings. Validation fails before any durable workflow state change,
runs unconditionally (including on resume and for already-completed steps),
and runs before role/agent bindings are derived for any pending step.

## Loading workflow steps

`loadWorkflowSteps(steps: WorkflowSourceStep[]): WorkflowStep[]`
(`v2/src/execution/workflow-loader.ts`) assembles the `agents`/`agentModelConfig`
that `executeWorkflow` requires from real config, ahead of the runner in the
pipeline. `WorkflowSourceStep` is `WorkflowStep` minus `agents` and
`agentModelConfig` — an authored step names only its `role`.

The loader loads the machine's configured agent order (falling back to
`DEFAULT_WRITE_AGENTS` when machine config has no `agents` key) and the global
`AgentModelConfig` once, attaches the same order/config to every step (no
per-step override), rejects any step naming `role: "operator"` or a role
outside the closed `Role` union, and reuses `executeWorkflow`'s own
`validateWorkflowStepRoles` (exported for this purpose) to check every
remaining step's role resolves for every loaded agent — all before returning.
Config load failure surfaces as-is; the loader adds no config-shape validation
of its own. This check runs once at load; `executeWorkflow`'s
`validateWorkflowStepRoles` still runs unconditionally on every invocation
(see [Validation](#validation)) regardless of whether steps came from this
loader.

## Budget and abort

No new workflow-level budget, pause, or abort concept — each step inherits its own `maxIterations`, `signal` (abort), and `pauseSignal` (pause). Values are per-step-configurable; there is no single shared workflow-level cap.
