# Role resolution

Canonical home for the v2 **role** taxonomy and how roles bind to workflow
steps. Behavior vocabulary lives in [`v2-vision.md`](v2-vision.md); the layered
model and orchestration context live in [`v2-architecture.md`](v2-architecture.md).
The `AgentModelConfig` schema and inner rung resolution land in a follow-on
agent-model-config slice.

## Closed `Role` union

Model resolution keys are concrete **roles**, not coarse categories. The closed
union:

| Role | Purpose |
| --- | --- |
| `plan` | Spec and plan authoring — draft, refine, and apply verdicts to the spec tree. |
| `implement` | Implementation authoring — write-loop code changes and post-completion shrink. |
| `adversary` | Read-only critique in a review debate — surfaces findings against the artifact. |
| `advocate` | Read-only defense in a review debate — responds to adversary findings. |
| `adjudicator` | Read-only verdict synthesis — emits the outcome-altitude instruction the actuator applies. |
| `actuator` | Verdict application — the only writer in a review-and-update cycle after the debate. |
| `operator` | Natural-language routing and steering (wired in Phase 9; behavior binding deferred). |

## Step binding and resolution

A workflow **step** binds three inputs: **behavior** (loop primitive), **prompt**
(task text), and **role** (model-resolution key). Behaviors are orchestration
primitives (`write`, `review-and-update`, `human`); they are not renamed to
match roles.

At invocation the runner:

1. Walks the per-machine **agent fallback order** (availability/quota chain).
2. Resolves **`(agent, role) → model`** from the role→model store for the
   landed agent.

Inner rung detail (tier start-index, head-only vs full-list consumption,
capability floors) is deferred to the agent-model-config slice.

## Role ↔ behavior reference

| Role | Behavior | Notes |
| --- | --- | --- |
| `plan` | `write` | Plan-mode spec authoring steps. |
| `implement` | `write` | Implement-mode write-loop steps; **shrink** (post-completion cleanup) also binds `implement` under `write`. |
| `adversary` | `review-and-update` | Read-only; first reviewer in each debate cycle. |
| `advocate` | `review-and-update` | Read-only; second reviewer. |
| `adjudicator` | `review-and-update` | Read-only; emits verdict. |
| `actuator` | `review-and-update` | Verdict application only — not shrink. Plan vs implement context comes from step metadata, not split resolution keys. |
| `operator` | — | Behavior binding deferred to Phase 9. |
| — | `human` | No agent resolution; pause for human review, approval, or resume. |

## Decisions

Load-bearing taxonomy choices recorded here:

- **Durable home is this file** — the closed `Role` union does not fold into
  `v2-architecture.md`; architecture cross-links here instead of duplicating
  the contract.
- **Categories retired** — `thinking` / `reviewing` / `executing` are not
  model-resolution keys. Roles align with how agents are actually invoked.
- **Behaviors stay orchestration primitives** — `write`, `review-and-update`,
  `human`; roles specialize steps, behaviors do not rename to match roles.
- **One `actuator` role** — plan vs implement context comes from step metadata,
  not `actuator-plan` / `actuator-implement` split keys.
- **Shrink binds `implement`** — post-completion shrink is `write`-loop
  implementation cleanup, not review-and-update verdict application; it does
  not map to `actuator` (which would collide with `reviewActuator` verdict-only
  tier semantics).
- **`operator` documented now, wired in Phase 9** — taxonomy is not blocked on
  NL-router implementation; behavior binding for `operator` is deferred until
  Phase 9 routes NL prompts.
- **`cheap` role deferred** — pin when a real non-deterministic consumer exists;
  deterministic commit-message/summary work stays on existing paths.
- **`v2-build-order.md` refresh deferred** — stale category prose there is
  refreshed when agent-model-config or Phase 5 implementation lands.
- **No v1 config migration** — document equivalence only; no dual-write or
  migration tooling in this taxonomy slice.
