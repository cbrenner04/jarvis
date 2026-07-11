# Role resolution

Canonical home for the v2 **role** taxonomy and how roles bind to workflow
steps. Behavior vocabulary lives in [`v2-vision.md`](v2-vision.md); the layered
model and orchestration context live in [`v2-architecture.md`](v2-architecture.md).
The `AgentModelConfig` schema and inner rung resolution are documented in
[`agent-model-config.md`](agent-model-config.md).

## Closed `Role` union

Model resolution keys are concrete **roles**, not coarse categories. The closed
union:

| Role | Purpose |
| --- | --- |
| `plan` | Spec and plan authoring — draft and refine spec and plan documents. |
| `implement` | Implementation authoring — write-loop code changes. |
| `shrink` | Hidden post-`implement` completion cleanup model resolution. |
| `adversary` | Read-only critique in a review debate — surfaces findings against the artifact. |
| `critic` | Read-only critique in a review — evaluates the artifact independently. |
| `advocate` | Read-only defense in a review debate — responds to adversary findings. |
| `adjudicator` | Read-only verdict synthesis — emits the outcome-altitude instruction the actuator applies. |
| `actuator` | Verdict application — the only writer after either review primitive produces a non-empty verdict. |
| `operator` | Natural-language routing and steering (wired in Phase 9; behavior binding deferred). |

## Step binding and resolution

A workflow **step** binds three inputs: **behavior** (loop primitive), **prompt**
(task text), and **role** (model-resolution key). Behaviors are orchestration
primitives (`write`, `review`, `review-debate`, `human`); they are not renamed to
match roles.
Workflow-step authoring and named preset resolution for this behavior vocabulary
live in [`workflow-runner.md`](workflow-runner.md#authoring-helper-and-presets).

At invocation the runner:

1. Walks the per-machine **agent fallback order** (availability/quota chain).
2. Resolves **`(agent, role) → rungs`** from the role→model store for the
   landed agent and walks the inner rung list.

Inner rung detail (consumption modes, flattening, terminal outcomes):
[`agent-model-config.md`](agent-model-config.md).

## Role ↔ behavior reference

| Role | Behavior | Notes |
| --- | --- | --- |
| `plan` | `write` | Plan-mode spec authoring steps. |
| `implement` | `write` | Implement-mode write-loop steps. |
| `shrink` | `write` | Hidden write-loop pass run by `executeWorkflow` after an `implement` write step returns `complete`. |
| `adversary` | `review-debate` | Read-only; first reviewer in each debate cycle. |
| `critic` | `review` | Read-only; independent critic for review workflows. |
| `advocate` | `review-debate` | Read-only; second reviewer. |
| `adjudicator` | `review-debate` | Read-only; emits verdict. |
| `actuator` | `review`, `review-debate` | Verdict application only — not shrink. Plan vs implement context comes from step metadata, not split resolution keys. |
| `operator` | — | Behavior binding deferred to Phase 9. |
| — | `human` | No agent resolution; pause for human review, approval, or resume. |

## Decisions

Load-bearing taxonomy choices recorded here:

- **Durable home is this file** — the closed `Role` union does not fold into
  `v2-architecture.md`; architecture cross-links here instead of duplicating
  the contract.
- **Categories retired** — `thinking` / `reviewing` / `executing` are not
  model-resolution keys. Roles align with how agents are actually invoked.
- **Behaviors stay orchestration primitives** — `write`, `review-debate`,
  `human`; roles specialize steps, behaviors do not rename to match roles.
- **One `actuator` role** — plan vs implement context comes from step metadata,
  not `actuator-plan` / `actuator-implement` split keys.
- **Shrink is its own role** — post-completion cleanup has explicit
  `(agent, shrink) → rungs` bindings. It no longer shares `implement`, and it
  does not map to `actuator` (which would collide with `reviewActuator`
  verdict-only tier semantics).
- **Model-resolution `shrink` is separate from telemetry phase** —
  `patch_phase: "shrink"` is a telemetry/workflow phase label, not a `Role`
  member alias or validation source.
- **`implement` collapses two independently configurable v1 tiers** — v1's `patchActuator` and `reviewActuator` (implement-side) each map to different configurable tiers; v2 maps both to `implement`, yielding one `(agent, implement) → model` binding per agent. When those v1 tiers differ, v2 cannot represent both independently without disambiguation beyond bare `(agent, role)`. Agent-model-config must not assume full v1 tier parity through a single `implement` key.
- **`operator` documented now, wired in Phase 9** — taxonomy is not blocked on
  NL-router implementation; behavior binding for `operator` is deferred until
  Phase 9 routes NL prompts.
- **`cheap` role deferred** — pin when a real non-deterministic consumer exists;
  deterministic commit-message/summary work stays on existing paths.
- **`v2-build-order.md` aligned** — Phase 5 + forward refs use role→model
  semantics.
- **No v1 config migration** — document equivalence only; no dual-write or
  migration tooling in this taxonomy slice.
