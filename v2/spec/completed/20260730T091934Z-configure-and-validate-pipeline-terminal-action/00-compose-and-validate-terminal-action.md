# Compose and validate terminal action at project-pipeline resolution

Project pipeline config selects stages and review posture but cannot state how the
final PR should be left. Extend the side-effect-free resolver so a registered project
must name one terminal action, the composed admitted definition carries it immutably,
and unknown or approval-incompatible choices fail before admission effects.

## Decisions

- `projects.<key>.pipeline` is exactly `{ "name": string, "terminalAction": string, "reviewOverrides"?: { "<stageId>": string } }`. `terminalAction` is required when `pipeline` is present; allowed values are exactly `leave-draft`, `ready`, and `merge`. Rules out inferring the action from review posture or omitting it.
- Resolution deep-copies the selected source definition, applies review overrides, then sets `terminalAction` on the owned result; rules out rereading mutable project config at pipeline completion.
- `PipelineDefinition` carries the resolved `terminalAction`; registry source definitions omit it and resolution always supplies it; rules out a terminal-action field on source-registry rows.
- Parse-time `terminalAction` failures — missing field, unknown value, and malformed types (`null`, empty string, non-string) — return `invalid-project-pipeline-config` naming the full offending config path and occur before registry lookup; rules out `unknown-pipeline` or `invalid-pipeline-definition` for config-shape mistakes.
- Terminal-action approval-policy conflicts are checked against the composed definition after lookup and override application, before `validatePipelineDefinition`. The only conflict in this slice: a terminal action on a composed definition with no `kind: "workflow"` stage whose `workflow` is `implement`. That rejects `ready`, `merge`, and `leave-draft` alike because none can run without implement-stage PR evidence. Failure returns `invalid-project-pipeline-config` naming `projects.<key>.pipeline.terminalAction` and `projects.<key>.pipeline.name`; rules out `invalid-pipeline-definition` for this policy check. Zero `kind: "approval"` stages is not a conflict — `fast` + `merge` remains valid.
- Resolution remains side-effect free: failures return named errors only and perform no admission effects; parse-shape failures precede lookup when parse order permits (lookup-spy pattern from slice 1b); rules out pushing validation to daemon start or workflow dispatch.

## Task checklist

- Extend `PipelineDefinition`, `parseProjectPipeline`, and `resolveProjectPipeline` to require, parse, compose, and copy-isolate `terminalAction`; update the parse allowlist and forbidden-key loop.
- Add the implement-stage conflict guard on the composed definition before definition validation.
- Repair compile/fixture fallout from required `terminalAction` on admitted definitions (registry rows, daemon/workflow/persistence fixtures, type split as needed).
- Rewrite the existing positive resolution test so the composed definition includes `terminalAction` and no longer equals the raw registry row.
- Extend `project-pipeline-resolution.test.ts` with terminal-action parse negatives (missing, unknown, malformed types), conflict coverage, copy isolation for `terminalAction`, lookup-spy ordering, and guard-inversion coverage for the conflict guard.
- Document operator config (breaking required field when `pipeline` is present, complete example), the immutable admitted-definition field, validation ordering, and conflict semantics.

## Acceptance criteria

- [x] `project-pipeline-resolution.test.ts` — `resolves every terminal action into an isolated admitted definition` fails against the baseline, then confirms `leave-draft`, `ready`, and `merge` compose onto `fast` and `full-review` with `terminalAction` on independently owned admitted definitions (including `fast` + `merge`); mutating one resolved copy's `terminalAction` does not affect another.
- [x] `project-pipeline-resolution.test.ts` — `rejects unknown terminal actions and approval conflicts before admission` fails against the baseline, then confirms `invalid-project-pipeline-config` with named paths for missing, unknown, and malformed `terminalAction` values before registry lookup (lookup spy), and resolution failures perform no admission effects.
- [x] `project-pipeline-resolution.test.ts` — `rejects terminal-action approval conflicts` fails against the baseline with a fixture whose composed definition has no `implement` workflow stage, names `terminalAction` and `pipeline.name`, and turns RED when its conflict guard is inverted.

## Documentation updates

- `v2/docs/install-and-config.md` — required `terminalAction` when `pipeline` is present (breaking hand-edited config change, no migration machinery), allowed values, validation, implement-stage conflict rule, and a complete project example.
- `v2/docs/workflow-runner.md` — the terminal action on the immutable pipeline definition and pre-admission validation boundary.
- `v2/docs/v1-behaviors.md` — v2 pipeline-admission terminal-action behavior.
