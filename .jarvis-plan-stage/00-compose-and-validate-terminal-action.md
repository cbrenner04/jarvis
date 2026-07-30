# Compose and validate terminal action at project-pipeline resolution

Project pipeline config selects stages and review posture but cannot state how the
final PR should be left. Extend the side-effect-free resolver so a registered project
must name one terminal action, the composed admitted definition carries it immutably,
and unknown or approval-incompatible choices fail before admission effects.

## Decisions

- `projects.<key>.pipeline` gains one required terminal-action field alongside `name` and optional `reviewOverrides`; rules out inferring the action from review posture or omitting it when `pipeline` is present.
- Deferred to first consumer: serialized action spellings and the config key name — pin when `parseProjectPipeline` accepts them; allowed values are exactly `leave-draft`, `ready`, and `merge`.
- Resolution deep-copies the selected source definition, applies review overrides, then sets `terminalAction` on the owned result; rules out rereading mutable project config at pipeline completion.
- `PipelineDefinition` carries the resolved `terminalAction`; registry source definitions omit it and resolution always supplies it; rules out a terminal-action field on source-registry rows.
- Unknown or malformed terminal-action values return `invalid-project-pipeline-config` naming the offending config path before registry lookup when parse-order permits, otherwise before returning success; rules out `unknown-pipeline` or `invalid-pipeline-definition` for config-shape mistakes.
- Terminal-action approval conflicts are checked against the composed stage list after lookup and override application, before `validatePipelineDefinition`; conflicting fields are named in the error; rules out late rejection after stage execution or daemon admission.
- Deferred to first consumer: the exact approval-policy rule set and whether merge carries a separate approval-required config flag — pin when the conflict guard is implemented; at minimum `merge` must be incompatible with a composed definition that has zero `kind: "approval"` stages.
- Resolution remains side-effect free: failures produce named errors only and perform no pipeline-row, worktree, or agent effects; rules out pushing validation to daemon start or workflow dispatch.

## Task checklist

- Extend `PipelineDefinition`, `parseProjectPipeline`, and `resolveProjectPipeline` to require, parse, compose, and copy-isolate `terminalAction`.
- Add approval-policy conflict validation on the composed definition before definition validation.
- Extend `project-pipeline-resolution.test.ts` with resolution, unknown-action, pre-admission ordering, conflict, copy-isolation, and guard-inversion coverage.
- Document operator config, the immutable admitted definition field, validation ordering, and conflict semantics.

## Acceptance criteria

- [ ] `project-pipeline-resolution.test.ts` — `resolves every terminal action into an isolated admitted definition` fails against the baseline, then confirms leave-draft, ready, and merge remain in independently owned admitted definitions.
- [ ] `project-pipeline-resolution.test.ts` — `rejects unknown terminal actions and approval conflicts before admission` fails against the baseline, then confirms named errors precede any pipeline row, worktree, or agent invocation.
- [ ] `project-pipeline-resolution.test.ts` — `rejects terminal-action approval conflicts` fails against the baseline and turns RED when its conflict guard is inverted.
- [ ] Inverting the terminal-action parse, compose, conflict, or deep-copy guard makes its corresponding positive or negative test in `project-pipeline-resolution.test.ts` fail.

## Documentation updates

- `v2/docs/install-and-config.md` — terminal action values, validation, conflicts, and project example.
- `v2/docs/workflow-runner.md` — the terminal action on the immutable pipeline definition and pre-admission validation boundary.
- `v2/docs/v1-behaviors.md` — v2 pipeline-admission terminal-action behavior.
