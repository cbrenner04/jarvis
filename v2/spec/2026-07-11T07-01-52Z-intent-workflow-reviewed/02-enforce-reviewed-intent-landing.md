# Enforce reviewed intent isolation and landing

Wire the composed review step (subspec 01) into the intent completion boundary: enforce role filesystem isolation, manage the verdict lifecycle, run final validation, and land only reviewed output.

## Prerequisites

- The reviewed-intent builder (subspec 01) composes the light review step, prompts, bindings, and verdict path.

## Decisions

- Snapshot role boundaries: restore any critic filesystem edits and fail review; restore actuator edits outside `.jarvis-intent-stage/` and fail review; rules out relying on prompt compliance or retaining unauthorized edits.
- A pre-existing `.jarvis-intent-review-verdict.md` not owned by the resumable invocation is a collision; retain the current verdict on review failure, exclude it from intent validation/landing, and remove it after final validation succeeds; rules out overwriting foreign control data or contaminating durable output.
- Empty trimmed verdict converges without actuation; non-empty verdict invokes the actuator and repeats while cycles remain, with the final bounded actuation eligible to complete before final validation; rules out treating budget exhaustion as failure or requiring an extra critic cycle.
- Run intent validation once after convergence or final bounded actuation, immediately before landing; rules out per-cycle validation or landing unchecked final edits.
- Persist the successful review/final-validation boundary so landing, commit, push, PR, and finalization retries resume there without rerunning review; rules out retrying from cycle zero and changing reviewed output.
- Land and publish only after the review step completes; rules out exposing pre-review staged files or publishing after review failure.

## Tasks

- Enforce critic read-only and actuator staging-only filesystem boundaries with snapshot/restore.
- Manage the reserved verdict lifecycle (collision rejection, landing exclusion, diagnostic-on-failure, removal on success).
- Reuse the existing intent validator, transactional landing, and completion publisher after successful review, and preserve the post-review completion checkpoint across landing/publication retries.
- Cover convergence, boundary violations, collisions, retries, failure, git-enabled, and git-disabled execution.

## Acceptance criteria

- [ ] Empty verdict skips actuation and proceeds to final validation; non-empty verdict actuates and repeats within the bound, and the final allowed actuation may proceed directly to final validation.
- [ ] Critic edits or actuator edits outside `.jarvis-intent-stage/` are detected, restored, and fail review before landing.
- [ ] `.jarvis-intent-review-verdict.md` rejects foreign collisions, is excluded from intent validation and landing, remains diagnostic on failure, and is removed after successful final validation.
- [ ] Critic or actuator failure/non-completion prevents landing, commit, push, PR publication, and git-disabled durable output.
- [ ] Final validation runs after the last review action and immediately before only validated post-review intents land to the existing git-enabled or git-disabled destination.
- [ ] Retrying landing or any later completion boundary after successful review does not invoke critic or actuator again and retains existing publication semantics.
- [ ] `v2/docs/write-behavior.md` documents intent-review composition and enforceable role isolation without changing generic review defaults.

## Documentation updates

- Update `v2/docs/workflow-runner.md` with convergence, isolation, verdict lifecycle, final validation, and retry boundaries.
- Update `v2/docs/write-behavior.md` with intent-review isolation enforcement.
