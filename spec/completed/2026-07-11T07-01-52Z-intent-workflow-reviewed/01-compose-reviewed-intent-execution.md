# Compose reviewed intent builder

Add a parameterized reviewed-intent builder that appends one light `review` step to the split step, resolving prompts and role bindings. Runtime enforcement (role isolation, verdict lifecycle, final validation, landing) is subspec 02.

## Prerequisites

- `intent.prompt.review` and `intent.prompt.review-actuator` are governed and registered by subspec 00.

## Decisions

- Add a parameterized reviewed-intent builder while leaving `buildIntentWorkflowSteps` split-only; rules out changing the established `intent` preset to gain reviewed execution.
- The reviewed builder defaults `reviewPasses` to `1`, while `0` delegates to the split-only builder shape; rules out requiring callers to compose review or dispatching a zero-cycle step.
- Positive passes add one light `review` step with `maxCycles` equal to the requested count; rules out expanding passes into multiple review steps with separate state.
- Render `intent.prompt.review-actuator` with the critic verdict byte-for-byte in its delimited verdict slot; rules out generic review's verdict-only actuator invocation.
- Load independent `critic` and `actuator` chains from top-level machine `agents` order (or `DEFAULT_WRITE_AGENTS` when absent) and the repo profile selected by required `machineProfile`; rules out reusing the write-only loader, one shared resolved role, or nonexistent project model overrides.
- Validate every positive-pass `(agent, critic|actuator)` binding before daemon contact; zero-pass delegates before review config loading; rules out late role-resolution failure or making the split-only escape hatch depend on review bindings.
- Reserve worktree-root `.jarvis-intent-review-verdict.md`, a sibling of `.jarvis-intent-stage/`, as the review step's verdict path; rules out an implementation-selected or durable-output verdict path.

## Tasks

- Accept and validate an explicit non-negative integer review-pass count in the intent builder.
- Load and validate intent-review role bindings and compose both prompts onto the light review step.
- Reserve the verdict path and delegate to the split-only builder when passes are zero.
- Cover zero, default, and bounded multi-pass builder shapes plus binding/config error paths.

## Acceptance criteria

- [x] The reviewed builder defaults to split plus one light cycle; critic and actuator use independently loaded configured role bindings and the actuator step receives the governed context with the unchanged verdict.
- [x] Positive-pass binding/config errors and negative, fractional, or non-numeric pass counts fail before daemon contact; loading honors machine agent fallback/default order and the `machineProfile` role-model store with no project model override.
- [x] Zero review passes produces the split-only builder's step shape and adds no review step without changing the explicit `intent` builder.
- [x] The composed review step targets `.jarvis-intent-review-verdict.md` and carries `maxCycles` equal to the requested pass count.

## Documentation updates

- Update `v2/docs/workflow-runner.md` with reviewed builder ownership, binding loading, and review-step composition.
