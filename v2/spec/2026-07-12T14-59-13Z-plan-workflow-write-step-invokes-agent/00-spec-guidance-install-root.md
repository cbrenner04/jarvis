# 00 - Resolve spec-guidance from the install root

## Problem

`jarvis run workflow plan` / `plan-reviewed` / `plan-reviewed-light` log `iteration_started` and never spawn an agent.

`getSpecGuidancePath` (`v2/src/execution/write.ts:335-344`) derives spec-guidance from the jarvis **data** root when `jarvisRoot` is set: `join("~/.jarvis", "..", "..", "v1", "docs", "spec-guidance.md")` → `/Users/v1/docs/spec-guidance.md`, which does not exist. `executePlanDraftWrite` reads it unguarded (`write.ts:172`) **before** `runWriteStep` (`write.ts:212`), so it throws ENOENT before any binding is invoked — no `claude`/`codex`/`cursor` child, no post-`iteration_started` events.

Production sets top-level `jarvisRoot` (`plan-workflow-steps.ts:247,272` → `write-loop.ts:418`); the intent write step (`executeIntentSplitWrite`, `write.ts:222`) never sets it and reads no files, which is why intent spawns and plan does not. `render-plan-review-prompts.ts:30-35` carries the identical helper, so the review steps hold the same latent defect.

## Decisions

- Resolve spec-guidance from the jarvis **install** root (the checkout containing the running code), never from `jarvisRoot` — rules out keeping the data-root branch and merely repairing its `..` count, which conflates two unrelated roots and would re-break whenever the data dir moves.
- Delete the `jarvisRoot` parameter from the helper rather than leaving it accepted-and-ignored — rules out a silently dead argument that invites the same misuse.
- Fix `render-plan-review-prompts.ts` in this subspec — rules out landing a plan preset whose draft step spawns and whose review step then dies the same way.
- Cover with a plan-draft test that sets top-level `WriteExecuteInput.jarvisRoot` to a production-shaped path and asserts the binding was invoked — rules out re-passing on the existing tests (`write.test.ts:213-287`), which set `jarvisRoot` only inside `worktree` and so never exercise the broken branch.

## Acceptance criteria

- [ ] A plan draft write step whose `WriteExecuteInput.jarvisRoot` is a `~/.jarvis`-shaped path outside the repo invokes its agent binding and returns a step result.
- [ ] Spec-guidance resolution no longer reads `jarvisRoot`; no caller passes it to the helper in `v2/src/execution/write.ts` or `v2/src/execution/render-plan-review-prompts.ts`.
- [ ] A plan review prompt renders under the same `~/.jarvis`-shaped `jarvisRoot` without a filesystem error.
- [ ] Existing `v2/src/execution/write.test.ts` plan-draft and intent-split tests stay green.

## Documentation updates

- `v2/docs/workflow-runner.md` — write-step spawn contract: the write step invokes an agent subprocess through its resolved binding; prompt inputs are resolved from the install root, not the jarvis data root.
- `v2/docs/v1-behaviors.md` — plan preset write step spawns an agent (`plan`, `plan-reviewed`, `plan-reviewed-light`).
