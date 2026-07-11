# Compose reviewed intent execution

Extend the intent builder with bounded light review before the existing safe landing boundary.

## Prerequisites

- `intent.prompt.review` and `intent.prompt.review-actuator` are governed and registered by subspec 00.

## Decisions

- Add a parameterized reviewed-intent builder while leaving `buildIntentWorkflowSteps` split-only; rules out changing the established `intent` preset to gain reviewed execution.
- The reviewed builder defaults `reviewPasses` to `1`, while `0` delegates to the split-only builder shape; rules out requiring callers to compose review or dispatching a zero-cycle step.
- Positive passes add one light `review` step with `maxCycles` equal to the requested count; rules out expanding passes into multiple review steps with separate state.
- Render `intent.prompt.review-actuator` with the critic verdict byte-for-byte in its delimited verdict slot; rules out generic review's verdict-only actuator invocation.
- Load independent `critic` and `actuator` chains from top-level machine `agents` order (or `DEFAULT_WRITE_AGENTS` when absent) and the repo profile selected by required `machineProfile`; rules out reusing the write-only loader, one shared resolved role, or nonexistent project model overrides.
- Validate every positive-pass `(agent, critic|actuator)` binding before daemon contact; zero-pass delegates before review config loading; rules out late role-resolution failure or making the split-only escape hatch depend on review bindings.
- Snapshot role boundaries: restore any critic filesystem edits and fail review; restore actuator edits outside `.jarvis-intent-stage/` and fail review; rules out relying on prompt compliance or retaining unauthorized edits.
- Reserve worktree-root `.jarvis-intent-review-verdict.md`, a sibling of `.jarvis-intent-stage/`; rules out an implementation-selected or durable-output verdict path.
- A pre-existing verdict not owned by the resumable invocation is a collision; retain the current verdict on review failure, exclude it from intent validation/landing, and remove it after final validation succeeds; rules out overwriting foreign control data or contaminating durable output.
- Empty trimmed verdict converges without actuation; non-empty verdict invokes the actuator and repeats while cycles remain, with the final bounded actuation eligible to complete before final validation; rules out treating budget exhaustion as failure or requiring an extra critic cycle.
- Run intent validation once after convergence or final bounded actuation, immediately before landing; rules out per-cycle validation or landing unchecked final edits.
- Persist the successful review/final-validation boundary so landing, commit, push, PR, and finalization retries resume there without rerunning review; rules out retrying from cycle zero and changing reviewed output.
- Land and publish only after the review step completes; rules out exposing pre-review staged files or publishing after review failure.

## Tasks

- Accept and validate an explicit non-negative integer review-pass count in the intent builder.
- Load and validate intent-review role bindings, compose both prompts, and enforce role filesystem boundaries.
- Manage the reserved verdict lifecycle and bounded convergence.
- Reuse the existing intent validator, transactional landing, and completion publisher after successful review.
- Preserve the post-review completion checkpoint across landing and publication retries.
- Cover zero, default, bounded multi-pass, convergence, boundary violations, collisions, retries, failure, git-enabled, and git-disabled execution.

## Acceptance criteria

- [ ] The reviewed builder defaults to split plus one light cycle; critic and actuator use independently loaded configured role bindings and the actuator receives the governed context with the unchanged verdict.
- [ ] Positive-pass binding/config errors and negative, fractional, or non-numeric pass counts fail before daemon contact; loading honors machine agent fallback/default order and the `machineProfile` role-model store with no project model override.
- [ ] Zero review passes produces the split-only builder's step shape and invokes neither review role without changing the explicit `intent` builder.
- [ ] Empty verdict skips actuation and proceeds to final validation; non-empty verdict actuates and repeats within the bound, and the final allowed actuation may proceed directly to final validation.
- [ ] Critic edits or actuator edits outside `.jarvis-intent-stage/` are detected, restored, and fail review before landing.
- [ ] `.jarvis-intent-review-verdict.md` rejects foreign collisions, is excluded from intent validation and landing, remains diagnostic on failure, and is removed after successful final validation.
- [ ] Critic or actuator failure/non-completion prevents landing, commit, push, PR publication, and git-disabled durable output.
- [ ] Final validation runs after the last review action and immediately before only validated post-review intents land to the existing git-enabled or git-disabled destination.
- [ ] Retrying landing or any later completion boundary after successful review does not invoke critic or actuator again and retains existing publication semantics.
- [ ] `v2/docs/workflow-runner.md` documents builder ownership, binding loading, convergence, isolation, verdict lifecycle, final validation, and retry boundaries.
- [ ] `v2/docs/write-behavior.md` documents intent-review composition and enforceable role isolation without changing generic review defaults.

## Documentation updates

- Update `v2/docs/workflow-runner.md` with reviewed composition, config, artifact, isolation, validation, and completion semantics.
- Update `v2/docs/write-behavior.md` with intent-review composition and isolation enforcement.
