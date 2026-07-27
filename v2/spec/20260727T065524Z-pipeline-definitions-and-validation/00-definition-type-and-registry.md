# 00 - Pipeline definition type and source registry

Slice 1a of [per-project pipelines](../per-project-pipelines-brief.md), part 1.

## Problem

Nothing in v2 describes "intent → approve → plan → approve → implement" as a value.
A pipeline needs a definition type and a source-owned registry before any stage can
be executed or validated.

## Decisions

- Definitions live in `v2/src/execution/pipeline-definition.ts` (type) and `pipeline-registry.ts` (registry). Rules out a data file or `~/.jarvis/config.json`-supplied definitions, which would let project config ship executable composition.
- A stage is a discriminated union on `kind`: `workflow` (`{ stageId, kind, workflow, review }`) or `approval` (`{ stageId, kind }`). Rules out an open stage kind set and per-stage prompt overrides.
- `workflow` and `review` are both carried as `string` in the type, not as literal unions. The registry only ever assigns real base-workflow names and real posture names, but the *type* must be able to hold a bad value in either field — subspec 01's validator is the checker, not the compiler. Rules out importing the preset union into the type (makes an unknown-workflow value unrepresentable) and rules out a `PipelineReviewPosture` literal union for the same reason: `invalid-review-posture` in 01 would be untestable without a cast.
- `workflow` names only base workflows — `intent`, `plan`, `implement` — never a reviewed preset name (`intent-reviewed`, `plan-reviewed`, `plan-reviewed-light`) or the bare implement builder. A reviewed preset name in the `workflow` field is itself a validation error in 01, not an alternate spelling of a posture.
- `(workflow, review)` resolves to an executable preset/builder input by this table; cells with no realization are named so 01 can reject them, not silently mis-execute:

  | workflow    | none                | light                          | debate           |
  |-------------|----------------------|--------------------------------|-------------------|
  | `intent`    | `intent` preset      | `intent-reviewed` preset       | **unrealizable**  |
  | `plan`      | `plan` preset        | `plan-reviewed-light` preset   | `plan-reviewed` preset |
  | `implement` | **unrealizable**     | `implement` (`reviewBehavior: "light"`) | `implement` (`reviewBehavior: "debate"`) |

  `intent` has one reviewed preset, not one per posture, so `debate` has nothing to resolve to. `implement` has no unreviewed builder path (`ImplementReviewBehavior` is `"debate" | "light"` with no opt-out), so `none` has nothing to resolve to.
- `approval` stages carry no posture field. Rules out a posture on a stage that runs no workflow.
- Lookup is `getPipelineDefinition(name)` returning `{ ok: true; definition }` or `{ ok: false; error: { code: "unknown-pipeline"; name } }`. Rules out `undefined`-on-miss and throw-on-miss. This slice gives `unknown-pipeline` no operator-facing surface (no CLI command reports it yet) — deferred to the slice that adds a pipeline-selecting entry point.
- Registry ships two definitions — `full-review` (`intent(light) → approve → plan(debate) → approve → implement(debate)`) and `fast` (`intent(none) → plan(none) → implement(light)`) — the brief's two named examples, both fully realizable against the table above. Two, not one, so subspec 01's whole-registry validation test has more than a single row. Both definitions are truncated relative to the brief (no terminal draft-PR/ready/merge stage) pending the terminal-action slice — `fast` is not a complete pipeline as shipped here, only as much of it as this slice can validate.
- No terminal action (draft PR / ready / merge) on definitions. Deferred to slice 5.
- Deferred to first consumer: stage-ordering rules — pin when durable stage state (slice 2) keys on stage ID. (Duplicate-stage-ID and empty-stage-list rejection move to subspec 01's validator instead of staying deferred — see that subspec.)
- Deferred, not decided: precedence between a pipeline stage's `review` posture and the per-project implement review behavior read by the machine-config loader (`readProjectImplementReviewBehavior`). Nothing in this slice consumes posture at run time, so no precedence rule is set here.

## Task checklist

- [x] Add `PipelineDefinition`, `PipelineStage`, `WorkflowPipelineStage`, `ApprovalPipelineStage` types (`workflow` and `review` typed `string`).
- [x] Add the registry with `full-review` and `fast`, plus total `getPipelineDefinition(name)`.
- [x] Unit tests over both stage kinds and both lookup outcomes.
- [x] Document pipeline definitions vs. workflow presets, and the `(workflow, review)` resolution table, in `v2/docs/workflow-runner.md`.

## Acceptance criteria

- [x] A pipeline definition value can express a workflow stage (stage ID, workflow reference, review posture) and an approval stage (stage ID only); a new unit test constructs and reads back one of each kind. This is a types-and-registry subspec with no consumer yet — the test failing against pre-change code is a compile error (the module doesn't exist), not a behavioral failure, per the guidance's exemption for docs/types-only surfaces; no separate behavioral failing-test AC is required here.
- [x] `getPipelineDefinition` is total: a new test asserts a hit returns the named definition and a miss returns the `unknown-pipeline` error carrying the requested name, with no throw.
- [x] The registry exports `full-review` and `fast`, and a test asserts each stage's kind, workflow name, and posture in order.
- [x] Inverting the lookup guard (hit vs. miss) makes the corresponding test fail; the miss case's negative assertion (no definition returned alongside the error) fails too when inverted. No guard-inversion test is required for stage-kind narrowing — the discriminated union has no runtime guard to invert in a module with no consumer.
- [x] `bun run typecheck` and `bun run test:v2` pass.
- [x] `v2/docs/workflow-runner.md` documents pipeline definitions vs. workflow presets, the two stage kinds, the three review postures, and the `(workflow, review)` resolution table with its two unrealizable cells.

## Documentation updates

- `v2/docs/workflow-runner.md` — new section: pipeline definitions vs. workflow presets (a definition composes presets; it does not author prompts or steps), the two stage kinds, the three review postures, the `(workflow, review)` resolution table including the two unrealizable cells, and registry lookup semantics.
