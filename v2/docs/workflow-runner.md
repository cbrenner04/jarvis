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

For a multi-step preset, resolution happens per step when the runner reaches
it. The runner does not precompute one shared binding chain or reuse step
one's resolved bindings for step two, even when both positions use the same
role and loaded project agent/model config.

Within one step, the resolved binding chain is the loaded step `agents` order
flattened with each agent's configured rungs for that `role`. Quota on an
earlier binding can therefore fall through across both the current agent's rung
list and a later configured agent binding before the step succeeds.

For each `write` step in order:
1. Run its write loop (via `executeWriteLoop`) to a terminal outcome.
2. If the outcome is `complete` and the step role is `implement`, run one
   hidden shrink write loop before advancing.
3. If the outcome is `complete`, advance to the next step.
4. Any other terminal outcome (`blocked`, `contract_miss`, `invocation_failure`) or soft-stop (`budget-exhausted`, `paused`) stops the workflow at that step — no later steps are run.

The hidden shrink pass is not an authored workflow step. It reuses the completed
`implement` step's worktree, spec path, artifact path, step rules, agent order,
and model config, but resolves bindings as `(agent, role: "shrink") → rungs`
and uses prompt id `patch.prompt.shrink`. It runs only after `implement`
returns `complete`; `budget-exhausted`, `paused`, `blocked`, `contract_miss`,
and `invocation_failure` do not trigger shrink. A non-`complete` shrink outcome
replaces the workflow result kind at the implement step and prevents later
steps from running.

The `intent` preset is one `plan` write step with prompt `intent.prompt.split`.
When its step supplies `intentOutput`, completion validates the shared
`.jarvis-intent-stage/` contract after the step completes, checks that only that
directory changed, and lands every valid Markdown file transactionally under
`intentOutput.durableDir`. Staging is removed only after landing succeeds.

Landing runs before completion commit/push/PR publication; publication receives
the durable directory as `specPath`. Validation, boundary, collision, and
landing failures return `kind: "pre-publication"`, persist the completed step's
run as `failed`, retain staging, and include rerun guidance. Resume retries this
boundary without another agent invocation.
Existing destination files are accepted only
when byte-identical; differing collisions are never overwritten.
The workflow records landed filenames by invocation in the worktree's private
Jarvis state so a retry can distinguish its own output from a collision.

The trigger keys on the write step's `role` being `implement`, not on "is this
the shipped implement preset." Any hand-authored `write` step naming
`role: "implement"` also runs the hidden shrink pass, even outside the shipped
preset.

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

A human step may configure `onRevise: { repeatStepId, maxRevisions }`, naming
an earlier step (lower index) in the same authored `steps[]` array and a
revision budget. The daemon's `revise` decision (see
[`daemon-host.md`](daemon-host.md#revise-decision)) spawns `repeatStepId`'s
write loop again under a synthesized stepId `${repeatStepId}~r<n>` and moves
the human step's run to status `revising`. While `revising`, `executeWorkflow`
checks the highest-numbered `~r<n>` run for `repeatStepId`: once it reaches a
terminal outcome (`completed`, `failed`, or `blocked`), the human step's run
re-converges to `awaiting-human` (same run row) and `executeWorkflow` returns
`WorkflowResult.kind === "awaiting-human"`; otherwise it returns
`WorkflowResult.kind === "revising"` and the workflow stops at that step, same
as `awaiting-human`.

In a two-step composition, step two begins only after step one reaches
`complete`. Workflow success means both step-local write loops completed, not
just step one.

Return `WorkflowResult` indicates which step produced the stopping outcome
(`awaiting-human` included), its run ID, total iterations consumed across all
steps, and resumability.

Each step run also persists the workflow invocation snapshot that launched it:
one `invocationId` plus the authored `steps[]` metadata (`stepId`, `role`,
order). Daemon/TUI consumers read that snapshot back from daemon `list` rows as
per-step progress in authored order, without reconstructing future steps from
durable attempt history alone. See [`daemon-host.md`](daemon-host.md#workflow-snapshots-on-list-rows).
Hidden post-implement shrink runs do not add a step to this snapshot, so
daemon/TUI rows stay aligned to the authored workflow.

## Authoring helper and presets

`buildIntentWorkflowSteps` (preset: `intent`) accepts exactly one file `seed` or inline `seedText` and
an optional relative, non-traversing `targetDir`. It resolves the seed and
registered project before daemon contact; file seeds must be relative and remain
inside the project after symlink resolution. The slug is normalized from the file basename
or first inline words; empty, `index`, and `head` are rejected.

Target precedence is run override, project `plan.targetDir`, global
`modes.plan.targetDir`, then `spec`. Effective publication follows project
`plan.commit`, global `modes.plan.commit`, then `true`, with project `git: false`
disabling it. Git-enabled output uses branch `intent/<slug>` in
`~/.jarvis/worktrees`, and the GitHub default branch is used for both its base
ref and PR base. Durable output is `<targetDir>/ready-intents/`. Git-disabled
output is external `~/.jarvis/specs/<project-safe-id>/ready-intents/`; the run
does not publish Git or GitHub state. The project-safe ID is a path-safe form
of the registered project key.

The builder emits one `write` step with role `plan`, prompt
`intent.prompt.split`, the shared split prompt, and `.jarvis-intent-stage/` as
the artifact boundary. Branch, worktree, active-workflow, and seed-identity
collisions are named failures unless the recorded invocation ID matches the
resumable invocation. The seed mapping is fingerprinted so a distinct seed
cannot attach to an existing slug. Divergent remote state fails without reset,
force-push, suffixing, or publication.

**CLI usage (split-only):** `jarvis run workflow intent (--seed <path> | --seed-text <text>) [--target-dir <dir>]`

`buildReviewedIntentWorkflowSteps` (preset: `intent-reviewed`) extends the split workflow with an optional
review step. It accepts a non-negative `reviewPasses` parameter (defaulting
to `1`); zero passes delegates to the split-only builder, while positive values
add one critic-actuator review step with `maxCycles` equal to the pass count.
The builder loads independent `critic` and `actuator` agent chains from the
machine's configured agent order (or `DEFAULT_WRITE_AGENTS` when absent) and the
repo profile selected by `machineProfile`. Role bindings are validated before
daemon contact: the builder throws if either role lacks configured model
escalations for any loaded agent. The review step targets `.jarvis-intent-review-verdict.md`
(a sibling of `.jarvis-intent-stage/`) for the critic's verdict, and uses the
`intent.prompt.review` prompt for the critic role. Runtime enforcement of prompt
composition, verdict injection, and role isolation is deferred to subspec 02.

**CLI usage (split + review):** `jarvis run workflow intent-reviewed (--seed <path> | --seed-text <text>) [--target-dir <dir>] [--review-passes <n>]` — defaults to one review pass.

`buildPlanWorkflowSteps` (preset: `plan`) accepts a `--ready-intent <path>` and optional relative, non-traversing `targetDir`. It validates the ready-intent file pre-daemon: the file must be located in a `ready-intents/` directory, carry frontmatter `name:` matching the filename (minus `.md`), and include a `## Prerequisites` section. The name is normalized from the validated frontmatter; empty names are rejected.

Target precedence is run override, project `plan.targetDir`, global `modes.plan.targetDir`, then `spec`. Effective publication follows project `plan.commit`, global `modes.plan.commit`, then `true`, with project `git: false` disabling it. Git-enabled output uses branch `plan/<name>` in `~/.jarvis/worktrees`, and the GitHub default branch is used as the base ref. Durable output is `<targetDir>/<UTC-timestamp>-<name>/`. Git-disabled output is external `~/.jarvis/specs/<project-safe-id>/plans/<name>/`; the run does not publish Git or GitHub state. The UTC timestamp is generated once in the builder, pre-daemon, ensuring the spec-dir path is stable across the run.

The builder emits one `write` step with role `plan`, prompt `plan.prompt.draft`, `.jarvis-plan-stage/` as the artifact boundary, and the ready-intent content threaded as `intentSeed` for downstream write-step seeding (subspec 01). Branch, worktree, and project collisions are named failures. Divergent remote state fails without reset, force-push, suffixing, or publication.

**CLI usage:** `jarvis run workflow plan --ready-intent <path> [--target-dir <dir>]`

A workflow step is authored as a plain object literal `satisfies WorkflowStepInput`.
`WorkflowStepInput` (identical in shape to the runtime `AnyWorkflowStep`) is a
discriminated union on `behavior`, the closed vocabulary from
[`role-resolution.md`](role-resolution.md#role--behavior-reference):

- `behavior: "write"` — `{ stepId, role, ... }`, the full
  [`write-behavior.md`](write-behavior.md) loop shape plus per-step loop
  controls (`maxIterations`, `signal`, `pauseSignal`), keyed by a single
  `role`/`agents` order. Workflow infrastructure such as `stateStore` and
  `logSink` is not part of the public step contract; the runner normalizes
  those once at workflow scope.
- `behavior: "human"` — `{ stepId, project, branch }` only. It carries none of
  the write-loop-only fields (`role`, `agents`, `stepRules`,
  `agentModelConfig`, `expectedArtifactPath`) and no `worktree` — see
  [Execution contract](#execution-contract) above.
- `behavior: "review-debate"` — see
  [Review-debate dispatch](#review-debate-dispatch) below.
- `behavior: "review"` — `{ stepId, project, branch, cwd, prompt, agents,
  agentModelConfig, verdictPath, maxCycles }`, with separate `critic` and
  `actuator` agent orders. It has no actuator prompt; the non-empty critic
  verdict is the actuator prompt.

`behavior` is kept on the returned runtime step (not stripped) — the runner
dispatches on it. The helper passes loop-control fields through unchanged.

`resolveWorkflowPreset(name, steps)` validates a named preset's step count
and returns a `WorkflowStep[]`. Callers supply `stepId`, `role`, and the rest of
the per-step write-loop content for each position, omitting `behavior` (the
preset supplies `"write"` per position until the runner dispatches on behavior).
For `implement`, the caller's `role`/`promptId` on each step are discarded: the
preset pins `role: "implement"` and `promptId: "patch.prompt.body"`
unconditionally on all positions.

Current preset surface:

- `write-write`: two steps
- `implement`: one or two steps, with `role`/`promptId` fixed by the preset on both positions
- `intent`: one step (split only)
- `intent-reviewed`: two steps (split + review)
- `plan`: one step, with `role`/`promptId` fixed by the preset

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
- For a `write` step, for every agent in that step's `agents` order, that
  step's `agentModelConfig` contains an own binding entry for the step's
  `role`. `implement` write steps also require each agent to have a `shrink`
  binding, because completion immediately consumes it.
- For a `review-debate` step, the same check runs independently for each of
  the four debate roles' `agents` orders against the step's
  `agentModelConfig`.
- A `human` step has no role binding to validate.
- Every human step's `onRevise.repeatStepId`, if configured, names an earlier
  step (lower index) in the same `steps` array — a missing, self-referencing,
  or forward-referencing `repeatStepId` is rejected as a `defineWorkflow`-level
  error, reported as `(stepId, repeatStepId)` pairs, before any durable state
  change.

Workflow-source role misses are aggregated and reported as `(stepId, role,
agent)` tuples (role is the debate role name for a `review-debate` step) in
one synchronous failure. Inherited object properties do not count as
bindings. Validation fails before any durable workflow state change, runs
unconditionally (including on resume and for already-completed steps), and
runs before role/agent bindings are derived for any pending step.

## Loading workflow steps

`loadWorkflowSteps(steps: WorkflowSourceStep[]): WriteWorkflowStep[]`
(`v2/src/execution/workflow-loader.ts`) assembles the `agents`/`agentModelConfig`
that `executeWorkflow` requires from real config, ahead of the runner in the
pipeline. `WorkflowSourceStep` is `WriteWorkflowStep` minus `agents` and
`agentModelConfig` — an authored step names only its `role`. Loading `human`
or `review-debate` steps is out of scope for this helper.

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

## Building `implement` workflow steps from cwd + run args

`buildImplementWorkflowSteps({ cwd, branchName, baseRef, specPath }, deps?)`
(`v2/src/execution/implement-workflow-steps.ts`) turns "operator standing in a
project checkout, wants to run `implement`" into the `AnyWorkflowStep[]` payload
the daemon `start` RPC accepts.

**Linked-subspec routing:** When `specPath` points to a multi-subspec
`index.md`, the builder resolves the first unchecked linked subspec via
`resolveActiveLinkedSubspec`. The active subspec's resolved file path is set as
`expectedArtifactPath`, and that subspec's body is injected into the prompt
during iteration. Routing state is validated and protected during iteration:
agent-authored changes to index checkboxes are restored and reported as
`implement.index_routing_mutated`; agent edits to the active subspec's criteria
remain allowed. Harness advancement checks non-human-only acceptance criteria
only; unchecked human-only criteria do not block routing. After the final
linked subspec completes, shrink runs once. Direct subspec input (non-index
`specPath`) fails with `implement.requires_index`. Empty indexes (no linked
subspecs) and already-complete indexes (all checked) return complete without
implement or shrink invocation. Invalid linked paths fail before agent
invocation: `implement.malformed_link` (empty/invalid path syntax),
`implement.link_missing` (file not found), `implement.link_unreadable` (I/O
error), `implement.link_out_of_tree` (resolved path outside project).

**Non-linked routing:** When `specPath` is a direct subspec or an index with no
linked subspecs but tasks, routing behavior is unchanged (direct file routing).

Pipeline order is preset-fields-first, loader-last: the builder assembles a
`WorkflowSourceStep` directly (`behavior: "write"`, `stepId: "implement"`,
`role: "implement"`, `promptId: "patch.prompt.body"` — the preset's pinned
values — plus `stepRules: DEFAULT_WRITE_STEP_RULES` and the per-run
`worktree`/`specPath`/`expectedArtifactPath`), then runs it through
`loadWorkflowSteps` to attach `agents`/`agentModelConfig` from machine config,
then through `resolveWorkflowPreset("implement", ...)` as a step-count/pinned-field
re-affirmation. The reverse order does not typecheck: `resolveWorkflowPreset`
requires `agents`/`agentModelConfig` already present, and only
`loadWorkflowSteps` supplies them.

Project resolution matches `cwd` against `findProjectMatchForPath`
(`v1/src/config.ts`) — the same registry-only primitive `jarvis init`/`jarvis
config` populate, with no ad-hoc unregistered-checkout fallback. This is the
first `v2/src/**` module to import from `v1/src/**`; a precedent for future
v2 specs reusing v1 registry/config code, not yet an established convention.

Both project-resolution misses and `loadWorkflowSteps` failures (config-load,
role-validation) return a caller-facing `{ ok: false; error: string }` result
instead of throwing. Linked-subspec routing resolution failures also return
`{ ok: false; error: string }` with error prefixed by the specific kind
(e.g. `implement.link_missing: …`). `deps.resolveActiveLinkedSubspec` is a
test-only override seam; the builder does not accept an `--agents` override.

## Review-debate dispatch

A step declaring `behavior: "review-debate"` dispatches to
[`executeReviewDebate`](write-behavior.md#review-debate-cycle) instead of
`executeWriteLoop`. Unlike a `write` step's single `role` + single `agents`
order, a `review-debate` step declares per-role prompts (`adversary`,
`advocate`, `adjudicator`) and an independent `agents` fallback order per
debate role (`adversary`, `advocate`, `adjudicator`, `actuator`) — four
separate orders, not one order applied to all four roles. Before dispatch,
`executeWorkflow` resolves each role's `agents` order to that role's bindings
via the same two-axis resolution `write` steps use, then passes the four
per-role binding sets to `executeReviewDebate`.

Outcome mapping for a `review-debate` step reuses `WorkflowResult`
(`kind: WriteLoopOutcomeKind`, no new kind added): all configured cycles
completing without a role failure is `kind: "complete"`; a cycle aborting on
a role invocation failure is `kind: "invocation_failure"`. `resumable` is
always `false` — there is no durable run/resume for a `review-debate` step in
this slice (deferred to the first caller that needs mid-cycle resume); its
`runId` is synthesized for reporting only, not looked up via
`findRunByProjectBranch`. A `review-debate` step is excluded from the workflow
snapshot built for `write`/`human` steps (see
[Per-step attempt history](#per-step-attempt-history)) since it has no durable
run identity in this slice; mixing a `review-debate` step with `write`/`human`
steps in one workflow otherwise composes normally (ordered advancement, same
stop-on-non-complete rule).

This slice supports only programmatic/runtime construction of a
`review-debate` step as an object literal `satisfies WorkflowStepInput`;
`workflow-loader.ts` (and therefore YAML/config-file authoring) does not yet
support it — it still assumes one `role` per step.

## Review dispatch

A programmatic `review` step is an object literal `satisfies WorkflowStepInput`.
It declares `project`, `branch`, `cwd`, `prompt`, `verdictPath`, `maxCycles`,
shared `agentModelConfig`, and separate `agents.critic` and `agents.actuator`
orders. The non-empty critic verdict is the actuator prompt; there is no
actuator prompt field. When part of a reviewed intent workflow, the step also
carries `deferredIntentOutput` configuration: the write step's `intentOutput`,
a staging directory path, and an `invocationId` for landing after review
completes.

The runner validates every `(agent, role)` entry for both orders before it
creates a snapshot or durable state. When reached, it resolves the roles
independently through the normal agent/rung fallback, then runs the review
cycle with enforcement (for intent workflows).

**Enforcement and isolation:** When `deferredIntentOutput` is configured,
the review step enforces role filesystem boundaries. Before and after each
review cycle, the working tree is checked:
- **Critic read-only:** After the critic runs, the working tree must remain
  unchanged outside the reserved verdict file (`.jarvis-intent-review-verdict.md`).
  Any unauthorized changes are detected, the tree is restored, and review fails.
- **Actuator staging-only:** After the actuator runs, all changes must be
  within the configured staging directory (`.jarvis-intent-stage/`). Changes
  outside the staging directory are detected and fail review.

**Verdict lifecycle:** The verdict file at `verdictPath` is reserved for the
review step and managed by enforcement:
- Pre-existing non-empty verdict files indicate a foreign invocation owns them;
  review fails before any role invocation.
- The verdict file is created empty by the review cycle before each critic
  invocation and written with the critic's output.
- After successful review, the verdict file is excluded from intent validation
  and landing by the enforcement layer; it is not copied to the durable output
  directory.
- On successful landing (see below), the verdict file is deleted. On failed
  landing, it remains for diagnostics and can be inspected or removed manually.

**Landing and convergence:** When `deferredIntentOutput` is configured and
review completes successfully (all bounded cycles complete with `kind: "complete"`),
the enforcement layer immediately runs final intent validation and landing:
- The verdict file is excluded from the staged output before validation.
- The staged intent files are validated identically to a standalone intent
  write step (see [`workflow-runner.md` Intent preset](#authoring-helper-and-presets)).
- Valid intents are landed transactionally to the durable output directory;
  landing semantics match the standalone intent step's landing.
- The verdict file is deleted after successful landing.

If landing fails (collision, validation, or I/O error), the review step returns
`kind: "invocation_failure"` with `resumable: true`. The verdict file remains
for diagnostics. Resume retries landing without re-running critic or actuator,
preserving the reviewed output unchanged. After successful landing, the
completion checkpoint is preserved: landing or publication retries do not
re-run the review step.

An empty verdict (trimmed) or all bounded cycles without actuator invocation
converges to `complete` without landing (landing only occurs when
`deferredIntentOutput` is configured and cycles complete). Critic, actuator,
abort, verdict-I/O failures, and landing failures return `invocation_failure`
and stop later steps. `iterationsConsumed` counts cycles whose critic started,
including a role-failed cycle, but not pre-critic failures or landing attempts.

Each reached review step receives a fresh synthesized run ID and invokes
`onStepRunCreated` before role execution. The ID is reporting-only:
`resumable` is `false` for successful completion, `true` for
invocation_failure with deferredIntentOutput (landing retry). No durable run
row is created, and review state is never resumed between separate workflow
invocations. A review-only invocation gets a fresh snapshot and starts at
cycle zero. A mixed workflow may reuse a matching snapshot found through a
durable write or human step; matching includes each review entry's
`(stepId, behavior)`. Review entries remain in authored order in daemon/TUI
projection, with critic/actuator start and terminal completed/stopped progress,
while durable run lookup considers only write and human steps.

Workflow loading, presets, and YAML/config authoring do not accept `review` in
this slice.

Cycle semantics are defined in [`write-behavior.md`](./write-behavior.md#review-cycle).

## Budget and abort

No new workflow-level budget, pause, or abort concept — each step inherits its own `maxIterations`, `signal` (abort), and `pauseSignal` (pause). Values are per-step-configurable; there is no single shared workflow-level cap.
