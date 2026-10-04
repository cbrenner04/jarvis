## Verdict

**Required refinements to subspec 00:**

1. **Fix the preset/loader pipeline contradiction.** As drafted, the task checklist has the builder run its assembled step through `resolveWorkflowPreset(...)` then `loadWorkflowSteps(...)`, but the actual signatures don't compose in that order: `resolveWorkflowPreset` requires `agents`/`agentModelConfig` already present on its input, while `loadWorkflowSteps` requires `behavior` already present and supplies `agents`/`agentModelConfig` itself. No single intermediate object satisfies both calls in that sequence. The subspec must state a pipeline that actually typechecks — e.g. apply the preset's pinned fields (role/promptId/stepRules/contract) directly to the per-run step shape, then call `loadWorkflowSteps` last so it fills in `agents`/`agentModelConfig`. Specify the concrete intermediate type the builder produces at each stage so an implementer isn't left to reverse-engineer the correct order from the type errors.

2. **Pin the `stepId` value.** `WriteWorkflowStep.stepId` is required and currently unspecified anywhere in subspec 00. State the literal value the builder assigns (e.g. `"implement"`) in the task checklist.

3. **Name the exact source-to-destination field mapping for worktree fields.** The checklist currently says to assemble `projectRoot`/`projectName` "from the resolved project (`projectRoot`, `projectName`)" as if those are the resolver's own field names. State explicitly that the project-resolution result's fields (`root`, `key`) map to `projectRoot`/`projectName` respectively, so the mapping isn't left ambiguous for the implementer.

4. **Note the v2→v1 import as a new precedent in the documentation updates.** No existing `v2/src/**` file imports `v1/src/**` today, and this subspec is the first to do so via `findProjectMatchForPath`. It isn't prohibited by the current boundary rules, but the documentation update in subspec 00 should flag it as a first-instance pattern so future spec review doesn't need to re-derive whether it's an established convention.

5. **Clarify why `findProjectMatchForPath` is the correct primitive, not `resolveProject`.** The intent references `v1/src/resolve-project.ts`, but that module's `resolveProject` performs a broader chain (including ad-hoc/unregistered-checkout fallback) that would contradict subspec 00's own "no ad-hoc fallback" decision. Add a one-line clarification in the decision bullet stating that the builder deliberately uses the narrower `findProjectMatchForPath` primitive from `v1/src/config.ts`, not `resolveProject`'s full resolution chain, so a reviewer doesn't need to re-derive this from the source.

**Refinement to subspec 01:**

6. **Cover the unrecognized-subcommand case.** Add a task-checklist line or acceptance criterion for `jarvis run workflow <unrecognized>` (or bare `jarvis run workflow`) confirming it falls through to standard usage/command-not-found handling and exits nonzero, rather than leaving that dispatch path unspecified.

**Not required:** the machine-profile default-to-`"home"` behavior is pre-existing and correctly out of scope for this spec; no change needed there.