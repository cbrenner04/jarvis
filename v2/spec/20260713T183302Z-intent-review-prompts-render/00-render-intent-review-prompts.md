# Render intent review prompts

## Problem

`intent-reviewed` passes `intent.prompt.review` to the critic as literal text and
falls back to the raw verdict as the actuator prompt. The registered intent review
artifacts never reach either agent, so the preset can complete without reviewing
the staged intents.

## Decisions

- Render intent prompts at review dispatch from the current staging directory; rule out build-time rendering before split output exists.
- Concatenate staged Markdown files in filename order with explicit file boundaries; rule out reviewing only one intent from a multi-intent split.
- Tell the critic where runtime persists its stdout verdict, while preserving stdout as the verdict channel; rule out critic writes to the reserved verdict file.
- Specialize reviewed-intent dispatch through `deferredIntentOutput`; rule out changing generic, patch, or plan review prompt semantics.
- Pass the critic verdict unchanged into the registered actuator template; rule out the generic verdict-only actuator prompt.

## Work

- Add intent critic and actuator renderers using the prompt registry, staged Markdown, spec guidance, and verdict path.
- Wire reviewed-intent execution to the rendered critic prompt and verdict-aware actuator renderer.
- Update prompt metadata/text and revision markers where rendered bytes change.
- Add regression coverage for rendered agent inputs and non-empty-verdict actuation.

## Documentation updates

- Update `v2/docs/workflow-runner.md` to replace the deferred caveat with runtime composition and dispatch behavior.
- Update `v2/docs/prompts.md` to record the implemented intent prompt layering, placeholders, and verdict channel.
- Update `v2/docs/operator-runbook.md` to remove the stale untrustworthy-review warning for this defect without claiming unrelated review issues are fixed.
- Align `v2/docs/write-behavior.md` with the implemented renderer where its current intent-review contract is aspirational.
- Record the changed v2 behavior in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] An `intent-reviewed` critic receives the registered, layered critic prompt containing every staged intent, spec guidance, and the verdict destination; it does not receive the prompt ID as its prompt.
- [ ] A non-empty critic verdict is persisted unchanged and invokes the actuator with the registered, layered actuator prompt containing every current staged intent, spec guidance, and that unchanged verdict.
- [ ] An empty critic verdict still completes the review without invoking the actuator.
- [ ] Generic review plus existing patch and plan review prompt behavior stays green in `v2/src/execution/review-cycle.test.ts`, `v2/src/execution/review-debate-render.test.ts`, and `v2/src/execution/render-plan-review-prompts.test.ts`.
- [ ] `v2/docs/workflow-runner.md`, `v2/docs/prompts.md`, `v2/docs/operator-runbook.md`, `v2/docs/write-behavior.md`, and `v2/docs/v1-behaviors.md` describe the implemented intent-review prompt path without the deferred/dead-artifact caveat.
- [ ] `bun run typecheck` and `bun run test:v2` pass.
