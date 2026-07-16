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

Each write step resolves `iterationTimeoutMs` from `~/.jarvis/config.json`
(default `600,000` ms). Its watchdog starts immediately after
`iteration_started`, including before an agent subprocess exists. The resolved
budget is retained in the workflow snapshot, so resume and revise use it.
Timeout ends the step as non-resumable `iteration_timeout`.

For a multi-step preset, resolution happens per step when the runner reaches
it. The runner does not precompute one shared binding chain or reuse step
one's resolved bindings for step two, even when both positions use the same
role and loaded project agent/model config.

Within one step, the resolved binding chain is the loaded step `agents` order
flattened with each agent's configured rungs for that `role`. Quota on an
earlier binding can therefore fall through across both the current agent's rung
list and a later configured agent binding before the step succeeds.

Each write-loop iteration invokes an agent subprocess through its resolved
binding (`executeWrite` → `runStep`). Plan-draft and plan-review prompt inputs
such as `SPEC_GUIDANCE` resolve from the jarvis install root (module-relative to
the shipped tree), not from `~/.jarvis` or any other data-directory path.

A write step that fails before invoking its agent (`executeWrite` throws, e.g.
missing install-root prompt input) ends the run `failed` with
`invocation_failure` (`failureKind: "error"`, non-resumable). The structured log
records `iteration_started`, then `boundary_committed`, then
`run_execution_failed` with the error message — not `loop_finished`. Concurrent
abort wins over the throw and terminates as resumable `progress`.

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

`publication-workflow-steps.ts` owns named `intent` and `plan` publication rows. Each row selects its prompt, staging directory, output contract, and landing kind; shared project, target, Git, worktree, loading, and publication assembly is composed once. Input resolvers remain row-owned so intent seed and plan ready-intent validation retain their distinct contracts.

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

Fresh git-enabled external worktrees are created under `~/.jarvis/worktrees` and
receive a `node_modules` symlink to the registered project's `node_modules`
before the first write callback. Reused worktrees and `git: false` local paths
are not mutated.

The builder emits one `write` step with role `plan`, prompt
`intent.prompt.split`, the shared split prompt (plus v1-parity file-output and
write-loop step-rules suffixes at execution time), and `.jarvis-intent-stage/` as
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
For positive passes, the builder creates the split and review source steps, then
makes one `loadWorkflowSteps` call for both. It forwards its machine config path,
profile, and machines directory; the loader supplies both roles' machine-derived
bindings. Preset resolution receives only the loaded write step. Loader failures
return `{ ok: false, error }` with unchanged loader text before daemon contact.
The review step targets `.jarvis-intent-review-verdict.md`
(a sibling of `.jarvis-intent-stage/`) for the critic's verdict, and uses the
registered, layered `intent.prompt.review` prompt for the critic role. At dispatch,
runtime reads every staged Markdown file in filename order, adds explicit file
boundaries and `v1/docs/spec-guidance.md`, and names the verdict destination.
The actuator receives the likewise-rendered `intent.prompt.review-actuator` with
the unchanged verdict in its delimited data slot. Empty verdicts skip actuation.

**CLI usage (split + review):** `jarvis run workflow intent-reviewed (--seed <path> | --seed-text <text>) [--target-dir <dir>] [--review-passes <n>]` — defaults to one review pass.

`buildPlanWorkflowSteps` (preset: `plan`) accepts a `--ready-intent <path>` and optional relative, non-traversing `targetDir`. It validates the ready-intent file pre-daemon: the file must be located in a `ready-intents/` directory, carry frontmatter `name:` matching the filename (minus `.md`), and include a `## Prerequisites` section. The name is normalized from the validated frontmatter; empty names are rejected.

Target precedence is run override, project `plan.targetDir`, global `modes.plan.targetDir`, then `spec`. Effective publication follows project `plan.commit`, global `modes.plan.commit`, then `true`, with project `git: false` disabling it. Git-enabled output uses branch `plan/<name>` in `~/.jarvis/worktrees`, and the GitHub default branch is used as the base ref. Durable output is `<targetDir>/<UTC-timestamp>-<name>/`. Git-disabled output is external `~/.jarvis/specs/<project-safe-id>/plans/<name>/`; the run does not publish Git or GitHub state. The UTC timestamp is generated once in the builder, pre-daemon, ensuring the spec-dir path is stable across the run.

The builder emits one `write` step with role `plan`, prompt `plan.prompt.draft`, `.jarvis-plan-stage/` as the artifact boundary, and the ready-intent content threaded as `intentSeed` for downstream write-step seeding (subspec 01). Branch, worktree, and project collisions are named failures. Divergent remote state fails without reset, force-push, suffixing, or publication.

**CLI usage:** `jarvis run workflow plan --ready-intent <path> [--target-dir <dir>]`

`buildReviewedPlanWorkflowSteps` (preset: `plan-reviewed`) composes the loaded
plan draft with one loaded `review-debate` step. It defaults `reviewPasses` to
`1`; zero delegates to the draft-only `plan` workflow. Positive values set the
debate cycle limit and load the `adversary`, `advocate`, `adjudicator`, and
`actuator` orders from machine configuration. The debate uses
`plan.prompt.review.adversary`, `.advocate`, and `.adjudicator`; its
verdict-driven actuator applies the verdict at
`<spec-dir>/verdict-plan.md`.

**CLI usage (draft + debate):** `jarvis run workflow plan-reviewed --ready-intent <path> [--target-dir <dir>] [--review-passes <n>]` — defaults to one debate pass.
Choose it for adversarial review; `plan-reviewed-light` is the critic-actuator
alternative for a lighter editorial pass.

`buildReviewedPlanLightWorkflowSteps` (preset: `plan-reviewed-light`) composes
the loaded plan draft with one loaded `review` step. It defaults `reviewPasses`
to `1`; zero delegates to the draft-only `plan` workflow. Positive values set
the critic-actuator cycle limit and load separate `critic` and `actuator`
orders from machine configuration. Runtime rendering uses
`plan.prompt.review.critic` and `plan.prompt.review-actuator` against the
materialized draft; the critic verdict is written to
`<spec-dir>/verdict-plan.md`.

**CLI usage (draft + light review):** `jarvis run workflow plan-reviewed-light --ready-intent <path> [--target-dir <dir>] [--review-passes <n>]` — defaults to one review pass. `--review-behavior` is not accepted on this preset. Malformed pass counts (for example `1x`, `-1`, `1.5`) are rejected before daemon contact.

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
- `behavior: "review"` — `{ stepId, project, branch, cwd, profile,
  profileContext, agents, agentModelConfig, verdictPath, maxCycles }`, with
  separate `critic` and `actuator` agent orders. The profile owns prompt
  assembly and domain policies.

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
- `plan-reviewed`: one validated draft write step followed by a loaded `review-debate` step
- `plan-reviewed-light`: one validated draft write step followed by a loaded `review` step

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

**Fresh dispatch:** When `WorkflowRunnerInput.freshDispatch` is set to `true`,
the resume step-idempotence rules are suppressed for the targeted steps: a new
workflow invocation is created with a fresh `invocationId`, and any prior
`completed` or `failed` runs are replaced by new rows. Within a single
execution with `freshDispatch` set, a step touched multiple times (e.g., in a
linked-implement loop or after a shrink step) reuses the run row created during
that execution, avoiding duplicate rows per step. Without `freshDispatch` set,
the normal resume contract applies: prior `completed` runs are reused idempotently
and invocationId is inherited from the prior run's snapshot.

## Per-step attempt history

Each step maintains its own durable `(project, branch, stepId)` run independently:
- Distinct `run_id` per step.
- Distinct attempt history queryable via `findRunByProjectBranch({ project, branch, stepId })`.
- `stepId` must be unique within the workflow (enforced at invocation).
- `role` is the workflow-source validation key for the step but is not persisted in durable state — attempt history identifies steps by `stepId`, not role/binding.

A one-step workflow runs identically to a single-step `executeWriteLoop` invocation (same terminal outcomes, same resume behavior).

## Workflow run id status

`startWorkflowRun` returns the first step's run id. That step's row reaches `completed` when the step finishes, but later steps may still be running. A caller reading the returned run's status via `loadRun` gets a durable row status, not the workflow status.

To answer "is the workflow terminal?", the daemon computes a rollup: given the entry step's run, its workflow snapshot, and all sibling runs for that invocation, the rollup reports the first authored durable step whose status is terminal-but-not-`completed`, or `killed` if an authored durable step has no row in a non-live invocation, or `completed` if all authored steps are `completed`. When the invocation is still live (`executeWorkflow` running), the rollup reports `in-progress` regardless of row state. `review-debate` steps carry no run row and are skipped during the walk.

This rollup is computed at read time, never overwriting a step row's status in place — resume logic skips a completed step on-row, so a stale entry-row status would cause resume to re-run step 0.

The returned run id's status reported by daemon `wait` and `list` operations reflects this rollup for workflow entry runs: `wait` awaits the full workflow completion and returns the rollup status; `list` reports the rollup status for the entry row, while other step rows report their own durable statuses. This ensures callers reading the workflow's entry run ID get accurate workflow-level terminal status including later steps.

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

`loadWorkflowSteps(steps: WorkflowSourceStep[]): (WriteWorkflowStep |
ReviewWorkflowStep | ReviewDebateWorkflowStep)[]` (`v2/src/execution/workflow-loader.ts`) assembles
the `agents`/`agentModelConfig` that `executeWorkflow` requires from real
config, ahead of the runner in the pipeline. `WorkflowSourceStep` is a
behavior-discriminated `write | review | review-debate` union, with each
branch omitting `agents` and `agentModelConfig`; `human` steps remain outside
this helper.

The loader loads the machine's configured agent order (falling back to
`DEFAULT_WRITE_AGENTS` when machine config has no `agents` key) and the global
`AgentModelConfig` once. A `write` step receives the flat order/config and
retains its executable single-role check. A `review` step has no write `role`;
it receives a fixed `{ critic, actuator }` record, with the same machine-derived
order for both roles and the same model config. A `review-debate` step receives
the same machine-derived order and model config for each of `adversary`,
`advocate`, `adjudicator`, and `actuator`. There is no per-step or per-role
order override. The loader rejects write steps naming
`role: "operator"` or a role outside the closed `Role` union, then reuses
`executeWorkflow`'s own
`validateWorkflowStepRoles` (exported for this purpose) to aggregate every
missing `(stepId, role, agent)` binding across both step kinds before returning.
Config load failure surfaces as-is; the loader adds no config-shape validation
of its own. This check runs once at load; `executeWorkflow`'s
`validateWorkflowStepRoles` still runs unconditionally on every invocation
(see [Validation](#validation)) regardless of whether steps came from this
loader. When no profile is injected, profile selection uses
`resolveMachineProfile(machineConfigPath)`.

## Building `implement` workflow steps from cwd + run args

`buildImplementWorkflowSteps({ cwd, branchName, baseRef, specPath, reviewPasses }, deps?)`
(`v2/src/execution/implement-workflow-steps.ts`) turns "operator standing in a
project checkout, wants to run `implement`" into the `AnyWorkflowStep[]` payload
the daemon `start` RPC accepts. `reviewPasses` is validated as a non-negative
integer; `0` emits only the implement write step, while a positive value loads
one appended `review-debate` step with `maxCycles` equal to that count.

**Linked-subspec routing:** When `specPath` points to a multi-subspec
`index.md`, the builder and runner use the shared linked-subspec routing contract
to resolve the first unchecked linked subspec via
`resolveActiveLinkedSubspec`. The active subspec's path relative to the routing
base is set as `expectedArtifactPath`, and that subspec's body is injected into
the prompt during iteration. The routing base is the external worktree when it
exists on disk, otherwise the registered project root — so the first routing read
on a launch with no worktree yet resolves against the project root instead of
failing `ENOENT`. Once the write loop materializes the worktree, acceptance-criteria
verification, the index-mutation guard, and harness checkbox advancement all read
and write the worktree copy; index ticks land on the branch, not in the operator
checkout. Routing state is validated and protected during iteration:
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

`shared/linked-subspec-routing.ts` owns linked-subspec selection, advancement,
terminal detection, and named failure classification. `workflow-runner.ts` only
coordinates worktree reads, write-loop execution, and applying the shared result.

**Non-linked routing:** When `specPath` is a direct subspec or an index with no
linked subspecs but tasks, routing behavior is unchanged (direct file routing).

Pipeline order is preset-fields-first, loader-last: the builder assembles a
`WorkflowSourceStep` directly (`behavior: "write"`, `stepId: "implement"`,
`role: "implement"`, `promptId: "patch.prompt.body"` — the preset's pinned
values — plus `stepRules: DEFAULT_WRITE_STEP_RULES` and the per-run
`worktree`/`specPath`/`expectedArtifactPath`), then runs it through
`loadWorkflowSteps` to attach `agents`/`agentModelConfig` from machine config,
then through `resolveWorkflowPreset("implement", ...)` as a step-count/pinned-field
re-affirmation. The implement write step supplies no `promptPlaceholders`;
`executeWrite` resolves `patch.prompt.body`'s required placeholders from the
step (`SPEC_PATH`, `REPO_GUIDANCE` from the worktree root, active subspec from
`expectedArtifactPath`, `PATCH_RULES` from the registry). When `reviewPasses > 0`, the builder also loads one
`review-debate` source step (`stepId: "implement-review"`) in the same
`loadWorkflowSteps` call, then appends the loaded debate step after the resolved
implement write step. The debate step runs in the implement worktree, writes
`verdict-patch.md` beside the executed `specPath` (overwritten each cycle), and
 carries the implement review profile so `executeWorkflow` renders
`patch.prompt.review.*` per cycle at execution. Runtime order is implement write
→ terminal shrink (when routing completed work) → optional debate review. The
appended review is skipped — without hard-fail — when implement did not route
through a terminal linked subspec, including empty or already-complete indexes,
or when implement or shrink stopped non-`complete`. Actuator edits from a
completed review use the same workflow completion committer as implement write
edits. The reverse order does not typecheck: `resolveWorkflowPreset`
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

**Patch review prompt rendering:** `v2/src/execution/review-debate-render.ts`
binds the three read-only roles to `patch.prompt.review.adversary`,
`.advocate`, and `.adjudicator`. Each cycle renders those templates with the
executed spec tree, a branch change summary (`git diff --stat` plus changed
paths), the pass number, and `REVIEW_PASS_CONTEXT`. Within a cycle, the
adversary's stdout is injected as `ADVERSARY_FINDINGS` for the advocate, and
the advocate's stdout as `ADVOCATE_RESPONSE` for the adjudicator. Across
cycles, the prior cycle's adjudicator verdict is carried in
`REVIEW_PASS_CONTEXT` for every role in the next cycle. The actuator prompt
is composed from the patch verdict-actuator template (`buildVerdictActuatorPrompt`
in `v1/src/modes/patch/prompt.ts`) with the settled adjudicator verdict.
`renderReviewDebateCyclePrompts` and `nextReviewDebateCycleContext` expose the
per-cycle render and cross-cycle carry contract for callers that build
implement's appended `review-debate` step.

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

Programmatic source loading through `workflow-loader.ts` supports both `write`
and `review-debate` steps. A `review-debate` step may also be constructed as an
object literal `satisfies WorkflowStepInput`.

## Review dispatch

All `review` and `review-debate` steps use the same profile-bearing dispatch.
Builders for intent, plan, and implement select a `ReviewPromptProfile` and
its context; the runner selects only the light critic/actuator cycle or the
debate cycle. The profile selects verdict ownership and write boundaries, so
domain-specific enforcement is applied in one path without a generic
least-restrictive policy.

The review `cwd` is always the existing workflow worktree. This includes the
external split worktree for reviewed intent and the materialized plan or
implement worktree; the operator checkout is never substituted.

Reviewed intent reserves its verdict for the owning invocation, excludes it
from validation and landing, and retains it on review or landing failure.
Successful landing removes it. A completed-review or landing-failed checkpoint
resumes at landing without reinvoking review roles. Plan keeps its durable
`verdict-plan.md` and permits actuator spec edits. Implement keeps the
completed spec tree immutable while permitting implementation edits.

For reviewed intents, `cwd`, verdict handling, boundary enforcement, staging,
landing, and any enabled commit, push, and draft-PR publication all use the split
step's resolved external workspace, never the operator checkout.

**Implement light review:** The implement profile renders bounded
critic-actuator cycles in the implement worktree. It shares the same dispatch
and cycle semantics as plan and intent light review while retaining immutable
spec enforcement and implementation-only actuator edits.

The runner validates every `(agent, role)` entry for both orders before it
creates a snapshot or durable state. When reached, it resolves the roles
independently through the normal agent/rung fallback, then runs the review
cycle with enforcement (for intent workflows).

**Enforcement and isolation:** When the intent profile is configured,
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

**Landing and convergence:** When the intent profile is configured and
review completes successfully (all bounded cycles complete with `kind: "complete"`),
the enforcement layer immediately runs final intent validation and landing:
- The verdict file is excluded from the staged output before validation.
- The staged intent files are validated identically to a standalone intent
  write step (see [`workflow-runner.md` Intent preset](#authoring-helper-and-presets)).
- Valid intents are landed transactionally to the durable output directory;
  landing semantics match the standalone intent step's landing.
- The verdict file is deleted after successful landing.

After review succeeds, its durable checkpoint is recorded before landing. If
landing fails (collision, validation, or I/O error), the review step returns
`kind: "invocation_failure"` with persisted `failureKind: "landing"` and
`resumable: true`. The verdict file remains for diagnostics. Resume retries
landing without re-running critic or actuator, preserving the reviewed output
unchanged. After successful landing, git-enabled workflows commit, push, and
open or reuse the draft PR from that workspace; git-disabled workflows only
land local files and perform no Git or GitHub operation.

An empty verdict (trimmed) or all bounded cycles without actuator invocation
converges to `complete` without landing (landing only occurs when
the reviewed-intent landing policy is configured and cycles complete). Critic, actuator,
abort, verdict-I/O failures, and landing failures return `invocation_failure`
and stop later steps. `iterationsConsumed` counts cycles whose critic started,
including a role-failed cycle, but not pre-critic failures or landing attempts.

Each ordinary review step receives a fresh synthesized run ID and invokes
`onStepRunCreated` before role execution. Reviewed-intent review instead records
a durable run and uses it to resume landing after a recorded landing failure.
That run row's `specRef` and `specPath` identify what it reviewed: `specRef` is
the landing base ref (the base ref reviewed against) and `stagingDir` is
the staged intent tree under review, not the
verdict path).
A review-only invocation gets a fresh snapshot and starts at cycle zero. A mixed workflow may reuse a matching snapshot found through a
durable write or human step; matching includes each review entry's
`(stepId, behavior)`. Review entries remain in authored order in daemon/TUI
projection, with critic/actuator start and terminal completed/stopped progress,
while durable run lookup considers only write and human steps.

**Log events:** Only a reviewed-intent review step (a durable run row)
appends to that run's log — plain review steps have no run row and stay silent.
It appends `iteration_started` (the step's `attemptId`) before critic/actuator
execution, then a terminal `loop_finished` (outcome kind, cycles consumed,
`resumable`) once the step's outcome — including any landing that runs inline —
is known, on both the completed and `invocation_failure` paths. A step re-entered
at its landing checkpoint (resumed after a recorded landing failure) emits its
own `iteration_started`/`loop_finished` pair around that landing retry, on the
same run row.

Workflow loading accepts `review` source steps; presets and YAML/config authoring
do not accept them in this slice.

Cycle semantics are defined in [`write-behavior.md`](./write-behavior.md#review-cycle).

## Budget and abort

No new workflow-level budget, pause, or abort concept — each step inherits its own `maxIterations`, `signal` (abort), and `pauseSignal` (pause). Values are per-step-configurable; there is no single shared workflow-level cap.

## Publication landing

Publication rows select one closed landing hook: `intent-stage`, `plan-tree`, or
`none`. The hook runs after the final write or review boundary and before
completion commit, push, PR, or durable no-Git completion. Successful work and
pending landing are durable checkpoints; retries resume at landing or later
publication without rerunning agents.

`intent-stage` validates ownership and boundaries, then transactionally lands
validated Markdown into ready-intents. `plan-tree` validates `index.md` plus
numbered subspecs and transactionally lands them at the precomputed spec path.
Control files remain staged and successful landing removes transient staging.
Failures retain staging and diagnostics. `none` performs no filesystem landing.
