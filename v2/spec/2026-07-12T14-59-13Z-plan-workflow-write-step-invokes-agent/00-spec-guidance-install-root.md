# 00 - Resolve spec-guidance from the install root

## Problem

`jarvis run workflow plan` / `plan-reviewed` / `plan-reviewed-light` log `iteration_started` and never spawn an agent.

`getSpecGuidancePath` (`v2/src/execution/write.ts:335-344`) derives spec-guidance from the jarvis **data** root when `jarvisRoot` is set: `join("~/.jarvis", "..", "..", "v1", "docs", "spec-guidance.md")` → `/Users/v1/docs/spec-guidance.md`, which does not exist. `executePlanDraftWrite` reads it unguarded (`write.ts:172`) **before** `runWriteStep` (`write.ts:212`), so it throws ENOENT before any binding is invoked — no `claude`/`codex`/`cursor` child, no post-`iteration_started` events.

Production sets top-level `jarvisRoot` (`plan-workflow-steps.ts:247,272` → `write-loop.ts:418`); the intent write step (`executeIntentSplitWrite`, `write.ts:222`) never sets it and reads no files, which is why intent spawns and plan does not. `render-plan-review-prompts.ts:30-35` carries the identical helper, so the review steps hold the same latent defect.

## Decisions

- Resolve spec-guidance only via the module-relative path already present as the helper's fallback (`join(import.meta.dir, "..", "..", "..", "v1", "docs", "spec-guidance.md")`), deleting the `jarvisRoot` branch — rules out repairing that branch's `..` count, which conflates the data root with the install root and re-breaks whenever the data dir moves.
- Delete the `jarvisRoot` parameter from the helper rather than leaving it accepted-and-ignored — rules out a silently dead argument that invites the same misuse.
- Remove the top-level `WriteExecuteInput.jarvisRoot` field and its threading through `write-loop.ts`, `PlanReviewPromptContext`, and `plan-workflow-steps.ts`; the spec-guidance read was its only consumer — rules out retaining a field nothing reads, the same accepted-and-ignored hazard one layer up. `worktree.jarvisRoot`, which has other consumers, is untouched.
- Fix `render-plan-review-prompts.ts` in this subspec — rules out landing a plan preset whose draft step spawns and whose review step then dies the same way.
- A genuinely missing `v1/docs/spec-guidance.md` still throws; that throw terminates the run through 01's named-failure path — rules out inventing an empty-guidance fallback that would silently draft specs without guidance.
- Cover by building each preset's draft step through the production step-builder and asserting the binding was invoked — rules out re-passing on the existing tests (`write.test.ts:213-287`), which set `jarvisRoot` only inside `worktree` and so never exercised the broken branch.

## Acceptance criteria

- [ ] The draft write step of each of `plan`, `plan-reviewed`, and `plan-reviewed-light`, constructed through the production step-builder, invokes its agent binding and returns a step result.
- [ ] The rendered plan-draft prompt carries the content of `v1/docs/spec-guidance.md`.
- [ ] Spec-guidance resolution takes no root argument in `v2/src/execution/write.ts` or `v2/src/execution/render-plan-review-prompts.ts`, and no top-level `jarvisRoot` field remains on `WriteExecuteInput`, `PlanReviewPromptContext`, or the `plan-workflow-steps.ts` step-builder inputs.
- [ ] A plan review prompt renders without a filesystem error.
- [ ] Existing `v2/src/execution/write.test.ts` plan-draft and intent-split tests stay green.

## Documentation updates

- `v2/docs/workflow-runner.md` — write-step spawn contract: the write step invokes an agent subprocess through its resolved binding; prompt inputs are resolved from the install root, not the jarvis data root.
- `v2/docs/v1-behaviors.md` — plan preset write step spawns an agent (`plan`, `plan-reviewed`, `plan-reviewed-light`).
