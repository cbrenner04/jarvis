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
budget is retained in the workflow snapshot, so resume uses it.
Timeout ends the step as non-resumable `iteration_timeout`.

Each write step also resolves `idleOutputMs` from `idleOutputTimeoutMs`
(default `90,000` ms; `0` disables — the key is then omitted, not resolved as
zero). When armed, a step or reprompt invocation that produces no output for
that budget ends the step as non-resumable `idle_output_timeout`, well before
`iterationTimeoutMs` could fire. The resolved bound (when armed) is retained in
the workflow snapshot alongside `iterationTimeoutMs`/`iterationCeilingMs`, so a
resumed step stays armed with the same budget; see
[`write-behavior.md`](write-behavior.md).

Each `review` and `review-debate` step resolves `reviewRoleTimeoutMs` from
`~/.jarvis/config.json` (default `1,800,000` ms) and stamps it on the step's
`roleTimeoutMs`, bounding every critic/actuator/debate-role invocation within
that step. The same machine-wide `idleOutputTimeoutMs` governs their idle-output
watchdog: a configured positive value is stamped as `idleOutputMs`, `0` is
stamped to disable the watchdog, and an absent key leaves it unstamped so the
review-role invocation uses its 90 s fallback.

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
2. If the outcome is `complete` and the step role is `implement`, commit its
   output, then run one hidden shrink write loop before advancing. On a
   successful publication, the implement checkpoint, shrink edits, and any prior
   per-iteration write commits remain distinct SHAs on the branch; the terminal
   completion commit is a separate boundary commit (see `write-behavior.md`).
3. If the outcome is `complete`, advance to the next step.
4. Any other terminal outcome (`blocked`, `contract_miss`, `invocation_failure`) or soft-stop (`budget-exhausted`, `paused`) stops the workflow at that step — no later steps are run.

The hidden shrink pass is not an authored workflow step. It reuses the completed
`implement` step's worktree, spec path, artifact path, step rules, agent order,
and model config, but resolves bindings as `(agent, role: "shrink") → rungs`
and uses prompt id `patch.prompt.shrink`. The completed implement output is
committed first, so a shrink invocation failure preserves it on the branch. It
runs only after `implement` returns `complete`; `budget-exhausted`, `paused`,
`blocked`, `contract_miss`, and `invocation_failure` do not trigger shrink. A
non-`complete` shrink outcome replaces the workflow result kind at the
implement step and prevents later steps from running.

A shrink `invocation_failure` with `failureKind: "error"` after that checkpoint
is resumable. Resuming skips the completed implement write, re-runs shrink, and
continues to publication when shrink completes. A post-commit shrink
`contract_miss` is resumable the same way: the `implement~shrink` row settles
`paused` with a terminal `loop_finished` where `resumable: true`, resume skips
implement, and shrink runs again before publication. The shrink write loop may
already have emitted a non-resumable `loop_finished` for `contract_miss` or for
text-less `blocked` (`missing_blocker`); workflow-runner settle then appends a
second corrective `loop_finished` with `resumable: true` so list/wait operator
error composes to `resume` instead of generic `resumable_pause`. Operator error
and terminal selection use the chronologically last terminal log record on the
row (`loop_finished` or `run_execution_failed`). Other shrink failure kinds keep
their normal classifications. A shrink `contract_miss` appends
`contract_miss_detail` on the `implement~shrink` run log (not the implement row)
with truncated agent output for diagnosis.

The `intent` preset is one `plan` write step with prompt `intent.prompt.split`,
optionally followed by one light review step by default.
When its step supplies `intentOutput`, completion validates the shared
`.jarvis-intent-stage/` contract after the step completes, checks that only that
directory changed, and lands every valid Markdown file transactionally under
`intentOutput.durableDir`. Staging is removed only after landing succeeds.

Landing runs before completion commit/push/PR publication; publication receives
the durable directory as `specPath`. Validation, boundary, collision, and
landing failures return `kind: "pre-publication"`, persist the completed step's
run as `failed`, retain staging, and include rerun guidance. Resume retries this
boundary without another agent invocation. This seam also appends a
`loop_finished` record with `loopOutcomeKind: "landing_failed"` (`resumable:
true`) on the same run row, so the row's log agrees with its durable status
instead of ending on the write step's earlier `complete` boundary;
`composeRunOperatorError` maps it to `landing_failed`
(`nextAction: "resume"`, `retryable: true`), matching the review-landing seam's
`failureKind: "landing"` mapping below.
Existing destination files are accepted only
when byte-identical; differing collisions are never overwritten.
The workflow records landed filenames by invocation in the worktree's private
Jarvis state so a retry can distinguish its own output from a collision.
Intent publication metadata also records the exact canonical file seed paths
read by the builder; inline seeds record none. Durable output always lands
before those inputs are consumed. Git runs delete the mapped worktree files so
the completion commit contains both output and deletion. Git-disabled runs
delete safe in-project source files only after transactional landing. Failed
validation, landing, commit, push, or PR publication retains the source for
retry; resumed or deferred-review landing reuses the recorded metadata.

The trigger keys on the write step's `role` being `implement`, not on "is this
the shipped implement preset." Any hand-authored `write` step naming
`role: "implement"` also runs the hidden shrink pass, even outside the shipped
preset.

In a two-step composition, step two begins only after step one reaches
`complete`. Workflow success means both step-local write loops completed, not
just step one.

Return `WorkflowResult` indicates which step produced the stopping outcome,
its run ID, total iterations consumed across all steps, and resumability.

Each durable step run also persists the workflow invocation snapshot that launched it:
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

Target precedence is run override, then a canonical file seed's `<targetDir>/seeds/`
parent, project `plan.targetDir`, global `modes.plan.targetDir`, then `spec`.
Thus a file from `v1/spec/seeds/` or `v2/spec/seeds/` publishes to that same
surface's `ready-intents/`, even if configuration names the other surface.
Inline seeds and file seeds outside a direct `seeds/` parent use configured/default
routing. `intent-reviewed` delegates to this same builder. Effective publication follows project
`plan.commit`, global `modes.plan.commit`, then `true`, with project `git: false`
disabling it. Git-enabled output uses branch `intent/<slug>` in
`~/.jarvis/worktrees`, and the GitHub default branch is used for both its base
ref and PR base. Durable output is `<targetDir>/ready-intents/`. Git-disabled
output is external `~/.jarvis/specs/<project-safe-id>/ready-intents/`; Git-disabled
output remains external regardless of canonical seed location.
The run does not publish Git or GitHub state. The project-safe ID is a path-safe form
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

**Intent split contract:** the split prompt emits one ready-intent per
module-boundary surface the seed touches (persistence, daemon request
handling, CLI admission, execution loop, comparable seams), in dependency
order, not one intent per symptom. A seed touching only one surface still
emits exactly one intent. Later intents list earlier-surface behaviors in
their `## Prerequisites` section so plan runs consuming them one at a time see
the cross-surface dependency.

**CLI usage:** `jarvis run workflow intent (--seed <path> | --seed-text <text>) [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]`

The intent builder omits review only when `reviewPasses` is explicitly zero
(`--review-passes 0`). Omitted `reviewPasses` defaults to one light pass.
Positive passes select light review with `reviewBehavior: "light"` (the default),
or debate review with `reviewBehavior: "debate"`. Explicit flags override defaults.
For positive passes, the builder creates the split and review source steps, then
makes one `loadWorkflowSteps` call for both. It forwards its machine config path,
profile, and machines directory; the loader supplies both roles' machine-derived
bindings. Preset resolution receives only the loaded write step. Loader failures
return `{ ok: false, error }` with unchanged loader text before daemon contact.
The review step targets `.jarvis-intent-review-verdict.md`
(sibling of `.jarvis-intent-stage/`) for the critic's verdict, and uses the
registered, layered `intent.prompt.review` prompt for the critic role. At dispatch,
runtime reads every staged Markdown file in filename order, adds explicit file
boundaries and `v1/docs/spec-guidance.md`, and names the verdict destination.
The actuator receives the likewise-rendered `intent.prompt.review-actuator` with
the unchanged verdict in its delimited data slot. Empty verdicts skip actuation.
Intent review completion requires a critic invocation and its managed verdict
artifact; an empty artifact is valid evidence. A missing or empty staged workspace,
exhausted critic bindings, missing evidence, boundary violation, or Git inspection
error stops as `invocation_failure` with its persisted, operator-readable cause.
Boundary violations restore unauthorized changes and prevent landing.

`buildReviewedIntentWorkflowSteps` (preset: `intent-reviewed`) delegates to
`buildIntentWorkflowSteps` and emits a migration hint.

`buildPlanWorkflowSteps` (preset: `plan`) accepts a `--ready-intent <path>` and optional relative, non-traversing `targetDir`. It validates the ready-intent file pre-daemon: the file must be located in a `ready-intents/` directory, carry frontmatter `name:` matching the filename (minus `.md`), and include a `## Prerequisites` section. The name is normalized from the validated frontmatter; empty names are rejected.

Target precedence is run override, canonical ready-intent parent (`<targetDir>/ready-intents/`), project `plan.targetDir`, global `modes.plan.targetDir`, then `spec`. Thus canonical v1 and v2 queue inputs draft to their matching surfaces even when configuration names the other one. `plan-reviewed` and `plan-reviewed-light` delegate to this builder and share the same routing. Effective publication follows project `plan.commit`, global `modes.plan.commit`, then `true`, with project `git: false` disabling it. Git-enabled output uses branch `plan/<name>` in `~/.jarvis/worktrees`, and the GitHub default branch is used as the base ref. Durable output is `<targetDir>/<UTC-timestamp>-<name>/`. Git-disabled output is external `~/.jarvis/specs/<project-safe-id>/plans/<name>/` regardless of the ready-intent location; the run does not publish Git or GitHub state. The UTC timestamp is generated once in the builder, pre-daemon, ensuring the spec-dir path is stable across the run.

The builder emits one `write` step with role `plan`, prompt `plan.prompt.draft`, `.jarvis-plan-stage/` as the artifact boundary, and the ready-intent content threaded as `intentSeed` for downstream write-step seeding (subspec 01). Omitted `reviewPasses` defaults to one debate pass; pass `--review-passes 0` to emit draft-only (no review step). Positive explicit counts append either a light `review` step (`reviewBehavior: "light"`) or a debate `review-debate` step (the default when behavior is omitted). Branch, worktree, and project collisions are named failures. Divergent remote state fails without reset, force-push, suffixing, or publication.

Plan-drafted acceptance criteria follow the [both-direction guard contract](../../v1/docs/spec-guidance.md#failing-test-requirement-for-runtime-behavior-subspecs).

**CLI usage:** `jarvis run workflow plan --ready-intent <path> [--target-dir <dir>] [--review-passes <n>] [--review-behavior debate|light]`

`buildReviewedPlanWorkflowSteps` (preset: `plan-reviewed`) delegates to
`buildPlanWorkflowSteps` with identical defaults (one debate pass when review
options are omitted) and emits a migration hint. Explicit
`reviewPasses` and `reviewBehavior` options override those defaults. The debate
uses
`plan.prompt.review.adversary`, `.advocate`, and `.adjudicator`; its
verdict-driven actuator applies the verdict at
`.jarvis-plan-stage/verdict-plan.md`.
After the final review cycle, landing copies that exact artifact (including an
empty file) into the durable plan root, so the plan PR carries its final verdict.

`plan-reviewed` remains a compatibility alias for `plan` (behaviorally redundant;
same defaults). Explicit review flags override it. Bare `plan` already defaults
to one debate pass when review options are omitted; prefer bare `plan` over
`plan-reviewed`. Use `plan-reviewed-light` or `plan` with `--review-behavior light`
for a lighter critic-actuator pass.

`buildReviewedPlanLightWorkflowSteps` (preset: `plan-reviewed-light`) delegates to
`buildPlanWorkflowSteps` with `reviewBehavior` defaulting to `light` when omitted.
Explicit `reviewPasses` and `reviewBehavior` options override those defaults.
Positive values set the critic-actuator cycle limit and load separate `critic` and `actuator`
orders from machine configuration. Runtime rendering uses
`plan.prompt.review.critic` and `plan.prompt.review-actuator` against the
materialized draft; the critic verdict is written to
`.jarvis-plan-stage/verdict-plan.md`.

`plan-reviewed-light` remains a compatibility alias for `plan` with light review
behavior when `reviewBehavior` is omitted, and emits a migration hint. Explicit review flags override it.
All three primary commands accept both review flags; malformed values are
rejected before daemon contact.

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

Current primary preset surface:

- `write-write`: two steps
- `implement`: one or two steps, with `role`/`promptId` fixed by the preset on both positions
- `intent`: split write step plus one light review by default (`--review-passes 0` opts out)
- `plan`: validated draft write step plus one debate review by default (`--review-passes 0` opts out)
- aliases: `intent-reviewed` → `intent` (redundant), `plan-reviewed` → `plan` (redundant; bare `plan` defaults debate), `plan-reviewed-light` → `plan` (light `reviewBehavior` default on that alias)

Validation stays synchronous:

- Unknown preset names throw and include the invalid name.
- Wrong per-position array length for a preset throws before any workflow runs.

## Pipeline definitions

A pipeline definition (`v2/src/execution/pipeline-definition.ts`) composes named
workflow presets and manual approvals into an ordered value; it does not author
prompts or steps itself — that stays in `publication-workflow-steps.ts` and
`implement-workflow-steps.ts`. A definition is a `name` and a list of stages,
each one of two kinds:

- `workflow`: `{ stageId, kind: "workflow", workflow, review }` — `workflow` names
  a base workflow (`intent`, `plan`, `implement`), never a reviewed preset name.
- `approval`: `{ stageId, kind: "approval" }` — a manual gate; carries no posture.

`review` is one of three postures: `none`, `light`, `debate`. A `(workflow,
review)` pair resolves to an executable preset or builder input:

| workflow    | none              | light                                    | debate                       |
| ----------- | ----------------- | ----------------------------------------- | ----------------------------- |
| `intent`    | `intent` preset    | `intent-reviewed` preset                  | `intent` preset (`reviewPasses: 1`, `reviewBehavior: "debate"`) |
| `plan`      | `plan` preset      | `plan-reviewed-light` preset              | `plan-reviewed` preset        |
| `implement` | unrealizable       | `implement` (`reviewBehavior: "light"`)   | `implement` (`reviewBehavior: "debate"`) |

`implement` has no unreviewed builder path, so `none` is the sole unrealizable cell.

Admission validation (`validatePipelineDefinition` in `pipeline-definition.ts`) is a
pure pre-admission check: it returns `{ ok: true }` or `{ ok: false, errors }` and
never throws at run time. Callers pass a resolved `AgentModelConfig`; the validator
does not load machine profiles itself.

| code | field | When |
| ---- | ----- | ---- |
| `unknown-workflow` | `workflow` | `workflow` is not one of `BASE_WORKFLOW_NAMES` (`intent`, `plan`, `implement`). |
| `invalid-review-posture` | `review` | `review` is not `none`, `light`, or `debate`. |
| `unrealizable-review-posture` | `review` | Valid posture but no resolution for that workflow (`implement` + `none` only). |
| `missing-role-binding` | `review` | Realizable posture needs a review role with no key in the supplied config (see below). |
| `duplicate-stage-id` | `stages` | Two or more stages share a `stageId` (`stageId` on the error is `null`). |
| `empty-pipeline` | `stages` | Zero stages (`stageId` on the error is `null`). |

Each error is `{ code, stageId, field, message }`; `message` names the values relevant
to `code`. Multiple problems are returned in one pass.

Review posture → roles required before admission (role sets only, matching
`workflow-loader.ts` review / review-debate agent maps):

| posture | required roles |
| ------- | -------------- |
| `none` | (none) |
| `light` | `critic`, `actuator` |
| `debate` | `adversary`, `advocate`, `adjudicator`, `actuator` |

A role is **bound** for admission when at least one agent entry in the supplied
`AgentModelConfig` has that role key present (key presence, not per-agent
completeness). That rule is the validator's own pre-admission check; it is not
equivalent to run-time role→model resolution. At dispatch, `resolveInvocationBindings`
in `agent-model-config.ts` requires the role on **every** agent in the step's
agent list for that role and throws if any entry is missing. Passing
`validatePipelineDefinition` therefore does not guarantee run-time binding success
for asymmetric or hand-built configs that satisfy key-presence but not per-agent
completeness. `undefined` agent entries are tolerated in the admission scan; a
config that binds nothing fails with `missing-role-binding`, not a scan error.

`getPipelineDefinition(name)` is a total lookup returning
`{ ok: true, definition }` on a hit or `{ ok: false, error: { code:
"unknown-pipeline", name } }` on a miss; it never returns `undefined` or throws.
The `unknown-pipeline` code exists for lookup totality only; no operator or CLI
surface reports it yet (deferred until a pipeline-selecting entry point exists).

Precedence between a pipeline stage's `review` posture and per-project implement
review behavior from the machine-config loader is not decided here; nothing in this
slice consumes stage posture at run time.

The registry (`pipeline-registry.ts`) ships two definitions:

- `full-review`: `intent(light) → approve → plan(debate) → approve → implement(debate)`
- `fast`: `intent(none) → plan(none) → implement(light)`

Both omit a terminal draft-PR/ready/merge stage, deferred to a later slice.

## Resume contract

Resume replays the supplied `steps` array from the beginning on each
invocation, after the runner revalidates the whole array against the
resume-time config (see [Validation](#validation) below). The runner does not
do a separate pre-pass to locate a resume point. Instead, each step re-enters
through its own `stepId`-scoped run lookup (via
`findRunByProjectBranch({ project, branch, stepId })`): a step whose run is
already `completed` returns its stored result idempotently with no new work
and no binding resolution, and the first non-completed step becomes the first
step that performs fresh execution.

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

To answer "is the workflow terminal?", the daemon computes a rollup: given the entry step's run, its workflow snapshot, and all sibling runs for that invocation, the rollup reports the first authored durable step whose status is terminal-but-not-`completed`, or `killed` if an authored durable step has no row in a non-live invocation, or `completed` if all authored durable steps are `completed`. When the invocation is still live (`executeWorkflow` running), the rollup reports `in-progress` regardless of row state. Snapshots record the shared runner durability policy: write steps, reviewed-intent review, and review-debate are durable; ordinary review is non-durable. Snapshots created before this field default every step to durable, preserving legacy missing-row `killed` behavior.

This rollup is computed at read time, never overwriting a step row's status in place — resume logic skips a completed step on-row, so a stale entry-row status would cause resume to re-run step 0.

The returned run id's status reported by daemon `wait` and `list` operations reflects this rollup for workflow entry runs: `wait` awaits the full workflow completion and returns the rollup status; `list` reports the rollup status for the entry row, while other step rows report their own durable statuses. When hidden finalization owns the stopping outcome, both entry responses source `loopOutcomeKind`, `iterationsConsumed`, and error detail from that row rather than the earlier completed entry log; `resumable` remains eligible only when the entry row itself can resume.

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
branch omitting `agents` and `agentModelConfig`.

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

`buildImplementWorkflowSteps({ cwd, baseRef, specPath, ...launchOptions }, deps?)`
(`v2/src/execution/implement-workflow-steps.ts`) owns implement launch resolution
and turns "operator standing in a project checkout, wants to run `implement`"
into the `AnyWorkflowStep[]` payload
the daemon `start` RPC accepts. `reviewPasses` is validated as a non-negative
integer; omitted flag or absent project config defaults to one debate pass (`1`);
`--review-passes 0` emits only the implement write step, while a positive value loads
one appended `review-debate` step with `maxCycles` equal to that count.

The builder first resolves `specPath` from the caller's cwd, finds its registered
project root, verifies that the resulting project-relative path exists in
`baseRef`, then reads the source spec tree. If every non-human-only acceptance
criterion is checked (across every linked subspec, or in a single file), it exits
`1` with `implement.already_complete` before workflow construction, worktree creation,
or a run row. Index link checkboxes do not determine this check. A fully ticked implement
spec first asks the daemon to recover its own failed review-mutation lineage. The daemon
uses the newest durable failed review/review-debate row for the resolved `(project, branch)`
whose completed write sibling wrote that spec, admitting only
`surviving_mutation_failed`, `ready_gate_failed`, or `completion_commit_failed`. It verifies
the retained worktree and local branch and refuses a live claim as `worktree_claimed`; a
retired worktree or branch is `implement.recovery_target_missing`. An admitted
`implement.recover` runs only mutation re-verification, ready-gate repair, and publication:
it never resets the workspace or re-enters the write step. No admitted lineage falls through
to the ordinary `implement.already_complete` preflight.

For CLI launches, when the matched project's raw config record includes a `pipeline`
key, the builder reads that fragment, resolves its source definition and overrides
against the loaded agent model config, and carries the validated definition as admission
evidence. When the key is absent, admission skips resolution and proceeds with legacy
implement (no `pipelineDefinition`). Resolution preserves parse → source lookup →
override-target → composed-definition validation precedence. A named resolution error
stops the command before stale reset, daemon connection/start, durable run-row
creation, external-worktree materialization, or agent invocation. This gate only
validates implement admission when a pipeline is selected; dispatching the selected
pipeline's stages is deferred to the pipeline execution consumer.

**Linked-subspec routing:** When `specPath` points to a multi-subspec
`index.md`, the builder and runner use the shared linked-subspec routing contract
to resolve the first unchecked linked subspec via
`resolveActiveLinkedSubspec`. A linked workflow materializes and validates its
managed worktree before its first routing read or callback. The active subspec's
path relative to that worktree is set as `expectedArtifactPath`, and that subspec's
body is injected into the prompt during iteration. Acceptance-criteria
verification, the index-mutation guard, and harness checkbox advancement all read
and write the worktree copy; index ticks land on the branch, not in the operator
checkout. Routing state is validated and protected during iteration:
agent-authored changes to index checkboxes are restored and reported as
`implement.index_routing_mutated`; agent edits to the active subspec's criteria
remain allowed. Harness advancement checks non-human-only acceptance criteria
only; unchecked human-only criteria do not block routing. After the final
linked subspec completes, shrink runs once. Direct subspec input (non-index
`specPath`) fails with `implement.requires_index`. Empty indexes (no linked
subspecs) and empty indexes retain their routing behavior. A complete linked tree
is rejected at launch rather than starting a no-op workflow. Invalid linked paths fail before agent
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
The shared completion commit includes the final `verdict-patch.md` verbatim,
including an empty verdict, so implementation PRs retain that review record.

The CLI only parses launch flags and dispatches unresolved values to the builder.
The builder resolves project, path, branch, artifact, and review defaults before
returning steps. Project resolution matches `cwd` against `findProjectMatchForPath`
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

The runner dispatch boundary is governed by the
[`Workflow composition gate`](coding-standards.md#workflow-composition-gate).

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

**Patch review prompt rendering:** `shared/prompts/review-implement.ts` renders critic and
debate roles (`patch.prompt.review.critic`, `.adversary`, `.advocate`, `.adjudicator`) with the
executed spec tree, merge-base `BRANCH_DIFF` (stat, changed paths, unified diff), pass number,
and `REVIEW_PASS_CONTEXT`. Within a cycle, the
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
a role invocation failure is `kind: "invocation_failure"`. Each reached
`review-debate` step creates one durable `(project, branch, stepId)` run row
and one attempt for all roles and cycles. It commits `completed` only after
the debate and any deferred landing succeed; role and landing failures commit
`failed`. The row carries the complete authored workflow snapshot and joins
workflow rollup like a write row.

A non-fresh re-dispatch whose last attempt failed at the actuator with a
post-commit retryable `failureKind` (`timeout` or `stall`) is **actuator-only
retry**: it reuses the same run row, records one new attempt, and re-invokes
only the actuator against the already-adjudicated `verdictPath` content
(through the same `profile.render.actuator` path as the first attempt) —
the adversary/advocate/adjudicator roles and any hidden `~shrink` pass are
not replayed. Eligibility is read from the last attempt's persisted
`invocationFailureDetail` (`role: "actuator"` together with the retryable
`failureKind`); a debate-role failure or any other `failureKind` falls
through to a full debate cycle on a fresh run row, as before. A missing or
empty `verdictPath` on an eligible actuator-only retry settles a named
`invocation_failure` citing the path, with `resumable: false`. `freshDispatch`
bypasses actuator-only retry admission and always starts a fresh row, as does
`maxCycles > 1`: multi-cycle review always falls through to a full debate
cycle, even when the last attempt failed at the actuator, since an
intermediate cycle's actuator failure is not the step's terminal failure.

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

At the daemon boundary, workflow JSON stores the profile's serializable policy
and `domain`, never render callbacks. Immediately before either light or debate
dispatch, the runner resolves that domain through its executable profile registry
to restore the renderers for intent, plan, or implement.

The review `cwd` is always the existing workflow worktree. This includes the
external split worktree for reviewed intent and the materialized plan or
implement worktree; the operator checkout is never substituted.

Deferred review landing is generic over `intent-stage` and `plan-tree`.
Reviewed intent reserves its verdict for the owning invocation; plan writes its
verdict into `.jarvis-plan-stage/` and lands it verbatim in the durable plan
tree. Intent verdicts remain excluded and transient. A completed-review or
landing-failed plan or intent checkpoint resumes at landing without reinvoking
review roles; `freshDispatch` bypasses that checkpoint and runs review again.
Plan permits actuator spec edits.
Implement keeps the completed spec tree immutable while permitting implementation
edits.

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

Each role invocation (`critic`, `actuator`, and every `review-debate` role) is
armed with two bounds: a per-role wall-clock bound (`roleTimeoutMs`, resolved
from `reviewRoleTimeoutMs` at prepare time, default `1,800,000` ms) and a per-role idle-output budget
(`idleOutputMs`: configured positive value when present, 90_000 ms when the
config key was absent, or disabled when stamped as `0`). A wall-clock timeout on one binding
escalates to the next binding in the flat rung/agent list instead of settling
immediately, the same as quota; only the last binding's timeout classifies as
`failureKind: "timeout"` with `role`/`agent`/`model`/`boundMs` attribution. The
wall clock and idle budget are armed once per escalation segment (one
`executeWithQuotaFallback` call over the remaining binding suffix), not once
per rung — a rung reached by in-segment quota advancement shares the rest of
that segment's clock rather than getting a fresh timer; only a rung that starts
a new segment (after a prior segment timed out) gets a full fresh bound.
An idle-output stall (no stdout/stderr for `idleOutputMs`) classifies as
`failureKind: "stall"` with identical attribution and does not escalate. Both settle as `invocation_failure`
on the run row. A terminal timeout (every configured rung timed out, including a
single-binding list) sets `exhaustedRoleTimeout: true` on the detail and lists every
rung tried in `bindingAttempts` in profile order (`bindingId`, `agent`, `model`, and
`resultKind` — the rung(s) actually aborted by the wall clock report `"timeout"`;
a rung consumed by quota before the abort reports its real `InvocationResult`
kind, e.g. `"quota"`). When any rung in the invocation was consumed by quota
rather than the wall clock, `exhaustedRoleTimeout` is `false` even though the
settling `failureKind` is `"timeout"` — the deterministic-wall argument for
`stop` only holds when every rung genuinely timed out. An exhausted timeout
returns `resumable: false` and daemon `error.reason: "role_timeout"`
(`nextAction: "stop"`) — the wall is deterministic, so re-dispatching just spends the same
N × bound again. A non-exhausted timeout (mixed quota/timeout) and a stall both
return `resumable: true` and daemon `error.reason: "role_stalled"` for stall
(`nextAction: "retry_later"`); recovery is re-dispatching the same workflow, which in an
implement workflow reuses the completed write step's checkpoint without re-invoking the
write-step agent. The guard keys on the exhausted gate, not `failureKind` alone. A
successful (`ok`) result on a binding wins over a concurrently-firing wall-clock timer —
it settles the invocation rather than escalating or discarding the success. A
caller-signal abort (pause/kill) keeps its existing failure kind and does not advance
to a further binding.

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

After review succeeds, landing runs before the review step's durable
completion boundary is committed — the row never settles `done` /
`completed` while landing is still outstanding. If landing fails (collision,
validation, or I/O error), the review step returns `kind: "invocation_failure"`
with persisted `failureKind: "landing"` and `resumable: true`; no `done`
boundary is committed on that attempt. The verdict file remains for
diagnostics. Resume retries landing without re-running critic or actuator,
preserving the reviewed output unchanged. After successful landing, the
review step commits its `done` boundary, then git-enabled workflows commit,
push, and open or reuse the draft PR from that workspace; git-disabled
workflows only land local files and perform no Git or GitHub operation.

**Recovering a populated stage.** `jarvis run resume <runId>` targets the
review row's own `runId` — the same one `run list` / `run wait` show with
`landing_failed` (`nextAction: "resume"`). When `.jarvis-intent-stage/` still
holds files, the daemon detects the populated stage
(`resolveIntentFinalizationResumeContext`) and replays only the finalization
tail (`resumePopulatedIntentPublication`: promote `durableDir`, delete the
stage and verdict sidecars, commit, push, draft PR) from the persisted
workflow snapshot — never `spawnWriteLoop`, never a fresh split/critic/actuator
invocation. An empty or missing stage falls back to
`unsupported_resume_context` (`nextAction: "stop"`): there is nothing left to
promote, so the operator must inspect the run manually.

Resume reconstruction depends on state the persisted workflow snapshot does
not carry directly: `durableDir` is recovered solely from the sibling durable
write step's own row (`specPath`), not from the snapshot, and the staging
directory is the hard-coded `.jarvis-intent-stage/` constant rather than a
persisted value — the snapshot records neither the original landing nor
whether the worktree is git-enabled. Admission is not gated on git-enablement: a git-disabled worktree with a
populated stage is admitted for resume the same as a git-enabled one. The
commit/push/PR tail then runs its normal Git operations regardless, surfacing
as a visible resume failure if the worktree isn't a real Git repository. This
is an intentionally unguarded, out-of-scope boundary for this resume path,
not a gap to close silently.

The `failureKind: "landing"` detail is uniform across every review landing
seam — light review, standard (durable) review, and review-debate alike — so a
post-role landing failure never settles as an undifferentiated
`invocation_failure`: `composeRunOperatorError` maps it to `landing_failed`
(`nextAction: "resume"`, `retryable: true`), distinct from
`completion_commit_failed` (the workflow-completion publication tail's commit
failure, after landing already succeeded).

**Publication contract:** `.jarvis-intent-stage/` is transient working state; the
configured durable output directory (`intentOutput.durableDir` / landing
`output.durableDir`) is the durable output. Promotion — copying staged `*.md`
into `durableDir`, then removing `.jarvis-intent-stage/` and the verdict
sidecars — is not conditional on actuation: an empty (trimmed) critic verdict
still promotes and runs the workflow-completion publication tail (commit and,
when git-enabled, push/draft PR), attributing that commit to the write step's
own durably recorded completion agent (the agent that actually ran it), falling
back to its configured agent only when no durable record exists. If no agent is
resolvable at all, the run fails visibly instead of silently skipping
publication. Critic, actuator, abort,
verdict-I/O failures, and landing failures return `invocation_failure` and stop
later steps. `iterationsConsumed` counts cycles whose critic started, including
a role-failed cycle, but not pre-critic failures or landing attempts.

**No `done` on an unchanged head.** When the workflow-completion publication
tail's committer reports no `commitSha`, the run does not settle `completed`:
it names every outstanding path in `completion_commit_failed`'s
`completionCommitError`, combining `git status --porcelain` output with any
files still under the write step's `.jarvis-intent-stage/` — the latter
catches the case where the committer no-ops while the working tree isn't a
readable Git repo (so `git status` alone reports nothing), which is exactly
the shape that let a populated stage settle `done` in production.

Each ordinary review step receives a fresh synthesized run ID and invokes
`onStepRunCreated` before role execution. Reviewed-intent review instead records
a durable run and uses it to resume landing after a recorded landing failure.
That run row's `specRef` and `specPath` identify what it reviewed: `specRef` is
the landing base ref (the base ref reviewed against) and `stagingDir` is
the staged intent tree under review, not the
verdict path).
A review-only invocation gets a fresh snapshot and starts at cycle zero. A mixed workflow may reuse a matching snapshot found through a
durable write step; matching includes each review entry's
`(stepId, behavior)`. Review entries remain in authored order in daemon/TUI
projection, with critic/actuator start and terminal completed/stopped progress,
while durable run lookup considers only write steps.

**Log events:** Only a reviewed-intent review step (a durable run row)
appends to that run's log — plain review steps have no run row and stay silent.
It appends `iteration_started` (the step's `attemptId`) before critic/actuator
execution, then a terminal `loop_finished` (outcome kind, cycles consumed,
`resumable`) once the step's outcome — including any landing that runs inline —
is known, on both the completed and `invocation_failure` paths. A step re-entered
at its landing checkpoint (resumed after a recorded landing failure) emits its
own `iteration_started`/`loop_finished` pair around that landing retry, on the
same run row.

**`intent_finalization` trace:** Every finalization attempt on either seam —
review-step landing (`finishReviewedLanding`) and the workflow-completion
publication tail alike — appends an `intent_finalization` log event: `phase`
(`"review_landing"` or `"completion_publication"`), `branch`, and an optional
`stopReason` set only when that attempt did not complete (absent on the happy
path). This traces which seam ran and why it short-circuited, independent of
the `loop_finished` outcome kind.

Workflow loading accepts `review` source steps; presets and YAML/config authoring
do not accept them in this slice.

Cycle semantics are defined in [`write-behavior.md`](./write-behavior.md#review-cycle).

## Budget and abort

No new workflow-level budget, pause, or abort concept — each step inherits its own `maxIterations`, `signal` (abort), and `pauseSignal` (pause). Values are per-step-configurable; there is no single shared workflow-level cap.

## Implement PR body template

Implement completion uses `deriveSpecRunBodySummary` (same renderer as plan)
with `specTemplate: true` so publication retries re-derive from the spec tree
and `baseRef...HEAD` diff. Sections: Subspecs, Commits, optional Risk cues,
Change summary — after the `Spec:` line, before narrative markers and
attribution. Sources: `v2/src/execution/workflow-runner.ts`,
`v2/src/execution/spec-run-body-summary.ts`,
`v2/src/execution/completion-publisher.ts`, `v2/src/execution/pr-body-refresh.ts`.

## PR body narrative markers

v2 `refreshPrBody` manages a reserved narrative marker block in PR body text:
`<!-- jarvis:narrative:start -->` and `<!-- jarvis:narrative:end -->`. The block
carries machine-authored narrative text (e.g., generated intent summary, run
context, or authored notes).

### Narrative authoring in implement workflows

The shrink pass (see above: [execution contract](#execution-contract)) authors a
review-altitude narrative summarizing what changed, why, and how to verify,
distinct from the spec header. The shrink agent writes the narrative to
`.scratch/shrink-narrative.md` inside the worktree; the runner reads it after
shrink completes and threads it into the publication input. The publication
path passes the narrative to `refreshPrBody`, which renders it inside marker
blocks in the PR body. Only implement workflows generate a narrative; plan and
intent publication paths do not. If the narrative file is absent or unreadable,
publication succeeds without one (graceful fallback — missing narrative does not
fail the run).

### Narrative preservation and re-publication

When `refreshPrBody` is called with an optional `narrative` input:

1. **Precedence:** An existing narrative extracted from the fetched PR body wins
   over the supplied `narrative` — this preserves human edits and prior
   machine-owned narrative on every re-publish, preventing supplied narrative
   from clobbering manual updates.
2. **Fallback:** The supplied `narrative` fills the marker block only when the
   fetched body has no existing markers (preserves the common case of initial
   introduction).
3. **Marker emission:** Markers are emitted whenever narrative text (preserved or
   supplied) exists; when neither extracted nor supplied narrative exists, no
   marker block is emitted — keeps caller PRs that pass no narrative unchanged,
   with no empty-marker churn.
4. **Whitespace trimming:** Empty or whitespace-only supplied `narrative` is
   treated as absent, falling through to no-marker behavior when no extracted
   narrative exists.

The round-trip contract: if a caller supplies `narrative` to `refreshPrBody`,
`extractNarrative(writtenBody)` will later return either that narrative (when no
prior extracted narrative existed) or the preserved prior narrative (when one did
exist). This enables multi-step workflows to author once and carry the narrative
forward across re-publications without clobbering operator edits.

## Publication landing

Publication rows select one closed landing hook: `intent-stage`, `plan-tree`, or
`none`. The hook runs after the final write or review boundary and before
completion commit, push, PR, or durable no-Git completion. Deferred review
landing applies to both intent and plan trees. Successful write work and pending
review landing are durable checkpoints; retries resume at landing or later
publication without rerunning agents, while fresh workflow dispatches re-run
review.

`intent-stage` validates ownership and boundaries, then transactionally lands
validated Markdown into ready-intents. `plan-tree` validates `index.md`,
`intent.md`, and numbered subspecs and transactionally lands them at the
precomputed spec path; when present, `verdict-plan.md` is part of the same
transaction. Both hooks consume recorded queue inputs only after
landing: Git runs delete the mapped worktree inputs in the completion commit;
no-Git runs delete source inputs after durable output lands. Missing, external,
or symlink-escaped inputs are skipped. Control files remain staged and
successful landing removes transient staging. Failures retain staging and
diagnostics. `none` performs no filesystem landing.

## Publication idempotency

When a split's output branch (`intent/<slug>` or `plan/<name>`) already has a merged PR on the base ref, `findOrCreatePr` treats that merged PR as evidence of an already-published split and returns it as an idempotent success without creating a second PR. The check is keyed on the branch name and base ref, not file content or run id. If the merged PR's branch was deleted after merge and recreated from base, re-publication returns the original merged PR and does not open a duplicate. Only merged PRs are short-circuited; an open PR on the same branch uses the existing reuse path unchanged.

## Completion publication failures

Workflow completion publishes before running the ready gate, then runs diff-derived mutation verification and runtime smoke verification before flipping the draft PR. The ordering is: (1) commit and push → (2) draft PR → body refresh → (3) ready gate (scoped tests) → (4) mutation verification (adversarial test of changed guards and prompt renders) → (5) runtime smoke verification (load-aware discovery and execution from the run-base production diff) → (6) draft→ready flip. The verifier classifies production paths: code receives guard, comparison, and destructive-operation mutations; registered `prompts/**` artifacts require a scoped test that observes their rendered output; other production paths are inspected but receive no code mutations. Code mutation candidates are derived from code spans of a changed line: string literals, template literals, and comments are masked out first, and masking is line-scoped (an unterminated opening quote or template masks to end of line, and a line that is the interior or tail of a multi-line template or block comment is still lexed as code). Two masking limitations are known and fail-safe — masking only ever removes candidates, so they cost coverage but never produce a false `surviving_mutation_failed`: a regex literal containing a quote character opens a phantom masked span, and template-interpolation interiors (`${…}`) are masked along with the template. An uncovered prompt fails as `missing-render-coverage`, naming its template path. Runtime smoke follows actual relative imports from its CLI and daemon surfaces, then uses a valid bounded non-destructive probe for the selected surface: CLI runs `help`, and daemon runs a lifecycle handshake (start → status → stop) against an isolated temporary daemon within a shared wall-clock deadline, with unconditional cleanup. See [the runtime smoke verifier contract](write-behavior.md#runtime-smoke-verifier). Publication failures return `completion_commit_failed` with `completionCommitError`; red gates return `ready_gate_failed` with `readyGateError`; surviving mutations return `surviving_mutation_failed` with `survivingMutation` and source-file details; smoke failures return `runtime_smoke_failed` with `runtimeSmokeCommand` and `runtimeSmokeObservation`; failed flips return `ready_flip_failed` with `readyFlipError`. Completion-commit, ready-gate, and surviving-mutation failures exit `1`, demote the durable row to `failed` (or keep it `in-progress` during the verification tail), and are resumed with `nextAction: "resume"`. Smoke-failure and failed-flip failures are terminal non-resumable outcomes: they exit `1`, preserve durable `completed` status, and reject `resume` with `code: "terminal_run"`.

The publication tail (status transitions and the terminal `loop_finished`) settles the workflow's durable completion row: when the last step is durable (a write step, a review-debate step, or a reviewed-intent review step), that step's own row; when the last step is non-durable (e.g. a light review with no landing, whose run id is a synthesized, row-less `crypto.randomUUID()`), the completion step's hidden `~shrink` row if one exists, else the completion step's own row — on both the success and every failure path.

For publication and ready-flip failures, the result and terminal row also retain normalized operation, message, exit code, and bounded labelled stdout/stderr tails. Ready-flip failures record `resumable: false` in the `loop_finished` terminal row. A successful runtime verifier appends a separate `runtime_smoke_outcome`: `{ outcome: "observed-clean" }` for an executed clean probe, or `{ outcome: "not-runnable", inspectedPaths: string[], discoveryReason: string }` when discovery found no runnable surface. The latter fields are required and `discoveryReason` is non-empty.

## Ready gate repair

Implement recovery also has bounded mutation repair. `write.mutation-repair` may run at most `MAX_MUTATION_REPAIR_ATTEMPTS` (3) times; each repaired commit is fully mutation-reverified before its ready gate and can independently enter the existing `MAX_READY_GATE_REPAIRS` (3) loop. One recovery can therefore invoke up to `3 × (1 + 3) = 12` agents. A surviving, blocked, or unsettled repair settles `mutation_repair_exhausted` and requires operator intervention.

When the ready gate raises `ReadyGateError` during publication, the workflow runs a bounded repair loop: it reprompts the agent with the gate failure details, records the boundary, re-commits, and republishes up to 3 times (configurable via `MAX_READY_GATE_REPAIRS`). Each repair iteration consumes an iteration from the workflow's budget; repair stops early if the agent returns `blocked`. A deadline-killed gate (detected via exit code 124 or a deadline-kill marker in the output) skips repair, emits a `ready_gate_timeout` log event instead, and settles immediately as `ready_gate_failed` for resumption; this is a budget kill, not a red gate. Non-`ReadyGateError` failures (ready-flip failures) skip repair and settle immediately as `ready_flip_failed`. Repair iterations are recorded as `ready_gate_repair` log events with attempt count and gate exit code.
