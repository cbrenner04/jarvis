# 00 - Builder-owned implement launch resolution

## Scope

- Move implement project, path, branch, artifact, and project-review-default resolution from `v2/src/cli.ts` into `buildImplementWorkflowSteps`.
- Keep launch behavior unchanged while making the preset builder the workflow-policy boundary.

## Decisions

- `buildImplementWorkflowSteps` accepts unresolved CLI launch values plus cwd/config dependencies and returns pre-daemon validation errors; rules out workflow-specific launch policy remaining in `cli.ts`.
- Preserve existing realpath containment, branch default, artifact selection, config precedence, and error ordering; rules out coupling the ownership move to operator-visible changes.
- Keep `v2/src/cli.ts` intact and reduce it to parsing and builder dispatch; rules out a CLI file split.

## Task checklist

- Relocate implement launch resolution and its test seams into `implement-workflow-steps.ts`.
- Pass parsed implement values directly from CLI dispatch to the builder.
- Add direct builder coverage for registered-project resolution, contained and escaping symlinks, branch/artifact derivation, and project review defaults.
- Update durable architecture and v1-parity documentation for builder-owned resolution.

## Acceptance criteria

- [x] `v2/src/execution/implement-workflow-steps.test.ts` directly verifies that unresolved launch input is resolved and rejected by the builder before workflow steps are returned.
- [x] The implement launch, path-containment, config-default, and pre-daemon cases in `v2/src/cli.test.ts` stay green (behavior unchanged by the ownership move).
- [x] `v2/src/execution/implement-workflow-steps.test.ts` existing review composition cases stay green (behavior unchanged by the ownership move).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — make the implement builder the launch-resolution owner and leave CLI as parser/dispatcher.
- `v2/docs/v1-behaviors.md` — retain the existing launch contract while correcting its source ownership.
