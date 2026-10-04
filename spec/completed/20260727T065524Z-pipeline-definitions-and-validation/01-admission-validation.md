# 01 - Admission validation

Slice 1a of [per-project pipelines](../per-project-pipelines-brief.md), part 2.
Depends on subspec 00.

## Problem

A bad pipeline definition — typo'd preset name, bogus posture, a posture with no
realization for its workflow, a debate posture on a machine profile that binds no
`adjudicator`, two stages sharing an ID, an empty stage list — currently surfaces
three stages into a run, if at all. Validation must reject it up front and name the
offending stage.

## Decisions

- `validatePipelineDefinition(definition, { agentModelConfig })` is a pure function returning `{ ok: true } | { ok: false; errors: PipelineValidationError[] }`. Rules out throwing, and rules out first-error-only: an operator editing a definition should see every problem in one pass.
- Every error is `{ code, stageId, field, message }`. `message` is always present and contains the values named by `code`. Pipeline-scoped errors (`empty-pipeline`, `duplicate-stage-id`) have no single offending stage, so `stageId` is `null` for them and `field` is `"stages"`. Stage-scoped errors always carry the real `stageId`.
- Codes:
  - `unknown-workflow` (field `workflow`) — value is not one of the base workflow names.
  - `invalid-review-posture` (field `review`) — value is not `"none" | "light" | "debate"`.
  - `unrealizable-review-posture` (field `review`) — value is a valid posture but has no resolution for that workflow per subspec 00's table (`intent`+`debate`, `implement`+`none`); message names both the workflow and the posture.
  - `missing-role-binding` (field `review`) — the resolved posture needs a role with no binding in the supplied config; message also names the unbound role.
  - `duplicate-stage-id` (field `stages`, `stageId: null`) — two or more stages share a `stageId`; message lists the duplicated ID.
  - `empty-pipeline` (field `stages`, `stageId: null`) — the definition has zero stages.
  - Rules out one shared `invalid-stage` code.
- Base workflow names are checked against a dedicated exported name list (e.g. `BASE_WORKFLOW_NAMES` in `pipeline-definition.ts`), not `WORKFLOW_PRESET_BUILDERS`. Checking against the builder map would pull the whole step-builder graph into the validator for a three-name check; the name list still satisfies "no second hand-maintained list" because it lives next to the type it validates and subspec 00's resolution table is the single source both the list and the table are written against.
- Posture → required roles, matching `v2/src/execution/workflow-loader.ts`'s review/review-debate agent maps for the role *sets* only: `none` → none; `light` → `critic`, `actuator`; `debate` → `adversary`, `advocate`, `adjudicator`, `actuator`. The loader itself hands the full agent list to every role and never consults per-role bindings, so nothing here mirrors a binding check the loader performs — the binding requirement is this validator's own rule, anchored to the actual consumer that fails on a missing binding: role→model resolution against `AgentModelConfig` (`v2/src/config/agent-model-config.ts`), which looks up a model by role key per agent.
- A role is bound when at least one agent entry in the supplied `AgentModelConfig` (`Record<string, ModelsByRole | undefined>`) has that role key present. Rules out requiring every agent to bind every review role. States the check as key-presence, not "non-empty escalation" — empty rungs are already rejected at config load, so the two are equivalent and key-presence is the simpler true statement. The scan tolerates `undefined` agent entries (a valid `AgentModelConfig` shape); a config binding nothing validates as missing every role, not as a scan crash.
- Approval stages are validated only for stage identity; they have no workflow or posture to check.
- Validation takes the resolved `AgentModelConfig` as a parameter rather than loading a machine profile itself. Keeps the function pure and testable without profile fixtures on disk.
- Deferred to first consumer: where admission calls this (daemon start path) — pinned by slice 2.

## Task checklist

- [x] Add `validatePipelineDefinition`, `PipelineValidationError`, and `BASE_WORKFLOW_NAMES` (or equivalent name list).
- [x] One test per rejection case (`unknown-workflow`, `invalid-review-posture`, `unrealizable-review-posture`, `missing-role-binding`, `duplicate-stage-id`, `empty-pipeline`) asserting the message content specified per code above.
- [x] Test asserting every registered definition validates clean against a profile binding all review roles.
- [x] Test asserting a config binding no roles (empty `AgentModelConfig`, or an entry that is `undefined`) is rejected with `missing-role-binding` rather than throwing.
- [x] Document validation codes, the posture→role table, and the role-binding definition in `v2/docs/workflow-runner.md`.

## Acceptance criteria

- [x] A new test with a stage naming a workflow that is not in `BASE_WORKFLOW_NAMES` gets `unknown-workflow` and asserts the offending stage ID and the field `workflow` appear in the message; it fails against the pre-change code.
- [x] A new test with an out-of-union `review` value gets `invalid-review-posture` and asserts the stage ID and the field `review` appear in the message.
- [x] A new test with an `intent` stage under `debate` and a separate test with an `implement` stage under `none` (subspec 00's two unrealizable cells) each get `unrealizable-review-posture`, asserting the stage ID, the field `review`, the workflow name, and the posture appear in the message; the same stage under a realizable posture validates clean.
- [x] A new test with a `debate` stage against an `AgentModelConfig` missing an `adjudicator` role key gets `missing-role-binding` naming the stage ID, the field `review`, and the role; the same definition under `none` posture validates clean, proving the `none` guard suppresses the role-binding check rather than the config happening to satisfy it.
- [x] A new test with two stages sharing a `stageId` gets `duplicate-stage-id` with `stageId: null` and a message naming the duplicated ID; a definition with all-unique stage IDs validates clean on this check.
- [x] A new test with zero stages gets `empty-pipeline` with `stageId: null`; a definition with at least one stage validates clean on this check.
- [x] A test iterates the whole registry and asserts each definition validates clean against a profile binding all review roles.
- [x] A definition with multiple bad stages returns one error per bad stage, not just the first.
- [x] Inverting each added guard (unknown-workflow check, posture check, unrealizable-combination check, per-posture role-binding check, duplicate-ID check, empty-list check) makes at least one test fail; the `none`-posture case proves no role-binding error is emitted when the guard is meant to suppress it.
- [x] `bun run typecheck` and `bun run test:v2` pass.
- [x] `v2/docs/workflow-runner.md` documents the six validation codes, the posture→required-role table, the role-binding definition (key presence in `AgentModelConfig`, anchored to role→model resolution), and that validation is a pure pre-admission function, not a run-time throw.

## Documentation updates

- `v2/docs/workflow-runner.md` — extend the pipeline-definitions section with validation: the six error codes, the posture→required-role table, the role-binding definition, and that validation is a pure pre-admission function, not a run-time throw.
