# Skip the ready gate for markdown-only workflow stages

## Problem

Intent split and plan draft publish only validated Markdown, but completion still invokes the project's ready command. A missing or red command therefore blocks a stage whose output the suite cannot verify.

## Decision ledger

- Derive ready-gate admission from `resolveMarkdownOnlyWorkflowPromptId(promptId, landing)`; rules out a changed-path heuristic that could exempt a code-bearing step whose incidental diff is docs-only.
- Skip only the ready-gate invocation for `intent.prompt.split` and `plan.prompt.draft`; rules out reusing `skipReadyFinalization`, which would also bypass the remaining finalization tail and leave the PR draft.
- Preserve intent/plan landing validation and completion publication before finalization; rules out admitting non-Markdown stage output or suppressing the completion commit/PR.
- Keep code-bearing prompt finalization unchanged, including configured/default ready-command execution; rules out broad workflow-level gate suppression.

## Task checklist

- Thread prompt-derived ready-gate admission through completion publication into the shared ready finalizer.
- Omit the ready-gate invocation only for markdown-only workflow prompts while retaining required-integration, mutation, runtime-smoke, and draft-to-ready finalization behavior.
- Add focused finalization, prompt-routing, code-bearing, and staged-output provenance coverage.
- Update `v2/docs/install-and-config.md`, `v2/docs/write-behavior.md`, `v2/docs/workflow-runner.md`, and `v2/docs/v1-behaviors.md` in their existing ready-finalization sections.

## Acceptance criteria

- [x] `v2/src/execution/ready-finalize.test.ts` — `skips the ready gate but completes remaining finalization when admitted`; Keystone checkpoint: a markdown-only admission never spawns a missing ready command, still runs the remaining finalization tail and ready flip, fails against the pre-fix unconditional gate, and carries an in-test `// @mutate` directive that restores unconditional gate execution and turns the test RED.
- [x] `v2/src/execution/write-loop.test.ts` — `routes markdown-only workflow prompts around the ready gate`; Mutation checkpoint: both `intent.prompt.split` and `plan.prompt.draft` publish successfully without invoking a missing ready command, a code-bearing prompt on the same completion-publication path still surfaces `ready_gate_command_missing`, and an in-test `// @mutate` directive inverting prompt-derived admission turns the test RED.
- [x] `v2/src/execution/workflow-runner-publication.test.ts` — `markdown-only ready-gate skip retains staged non-Markdown rejection` stays green: an intent split staging a non-`.md` path settles `landing_failed` before completion publication or finalization.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — configured/default `readyCommand` applies to code-bearing stages; markdown-only intent split and plan draft skip it.
- `v2/docs/write-behavior.md` — prompt-derived ready-gate admission and preserved post-gate finalization ordering.
- `v2/docs/workflow-runner.md` — intent-split and plan-draft completion lands and publishes validated Markdown without running the project ready gate.
- `v2/docs/v1-behaviors.md` — record the v2 behavior change from unconditional workflow ready-gate execution.
