# Unlinked keystone checkpoint reprompts the implement to author the directive

## Problem

Implement completion hard-blocks `spec.criteria-ticked` with `Unlinked keystone checkpoints (no directive linked on the named pin)` on the first miss: the miss is not reprompt-eligible (`isRepromptEligibleMutationCheckpointMiss` admits only `Unparseable mutation checkpoints:`), and the entry run is non-resumable, so the whole spec strands. A greenfield subspec whose pinning file does not exist at plan time cannot carry a plan-time literal `// @mutate` directive on a ticked, canonically-suffixed `Keystone checkpoint:` criterion, so implementability depends on plan-agent variance rather than on the code and tests the implement lands (observed 2026-08-09, `tui-attention-segment-rows`, plan #2774).

## Behavior

When a ticked keystone criterion's pin resolves but carries no linked `// @mutate` directive, and that is the report's only blocking finding, the write loop reprompts the implement — naming the criterion and the resolved repo-relative pin path — and re-judges the contract on the next iteration, within `maxIterations`. Everything else is unchanged: an unresolved or ambiguous pin, a hollow guard, an inert headline, a malformed directive already sitting on the named pin, or any other blocking unparseable still hard-blocks with a harness `## Blocker`, and once a directive is linked the mutation verifier behaves as before.

## Decisions

- Keystone-unlinked reprompt reuses the loop's `maxIterations` budget; exhaustion settles the existing `Unlinked keystone checkpoints` blocker — rules out a dedicated keystone repair counter. Exhaustion still lands the run at the same non-resumable strand the intent names as the headline damage; this spec narrows how often that strand is hit, it does not remove it.
- New prompt `write.keystone-directive-reprompt` and new log event `keystone_directive_reprompt`, not reuse of `write.mutation-directive-reprompt` / `mutation_directive_reprompt` — the existing prompt says "retarget each directive" and its rows carry `reason: target_absent | target_ambiguous`, both of which presuppose a directive that does not exist here.
- Reprompt admits only when unlinked keystones are the report's sole blocking finding (no hollow, no inert headline, no blocking unparseable) — rules out reprompting on mixed failure, which would let a hollow guard ride along unreported. A malformed directive already sitting on the named keystone pin produces both a blocking `Unparseable mutation checkpoints:` entry and an unlinked-keystone entry, so it is mixed by this same rule and hard-blocks with both messages rather than reprompting — deliberate deferral: the agent gets no keystone-specific retarget prompt for a directive it already authored wrong; fixing that is the existing mutation-directive-reprompt seam's scope, not this one's.
- A keystone whose pin does not resolve (`unresolved_pinning_test`, `ambiguous_pinning_basename`) keeps hard-blocking — the implement did not write the named test, so there is nothing to author a directive on.
- No plan-draft change: keystone selection is by canonical suffix and never inspects on-disk directives, so a greenfield pin already drafts today; the gap is entirely at implement completion — rules out relaxing plan-draft or pre-authoring directives at plan time.
- Report entries widen the existing shared mutation-checkpoint entry type with an optional `pinPath` field, reused by guard and keystone entries alike, rather than forking a keystone-specific entry type — smaller blast radius on existing consumers of that type.
- At most one ticked keystone criterion can reach the reprompt per subspec: a second ticked `Keystone checkpoint:` criterion hard-blocks earlier with the existing `Multiple keystone checkpoints` refusal. The `write.keystone-directive-reprompt` prompt and `keystone_directive_reprompt` log event therefore carry a single criterion/pin-path pair, not an array — a deliberate shape, matching the existing one-keystone-per-subspec invariant.
- Prompt selection checks the existing pending mutation-directive-reprompt context before the new keystone context; the existing reprompt keeps precedence when both would otherwise be pending in the same iteration (a mixed unparseable-plus-unlinked-keystone report hard-blocks per the deferral above, so true same-iteration contention does not arise, but selection order is still pinned so behavior is deterministic if that changes later). Keystone reprompt context clears on the same terminal condition as the existing mutation-directive context: contract settle (pass or `contract_miss`) or iteration-budget exhaustion.
- Deliberate sibling deferrals, not oversights: a guard (`Mutation checkpoint:`) criterion with an unlinked directive still hard-blocks with no reprompt, and a mixed guard-plus-keystone miss still strands, same as today. The double verification pass and the missing per-iteration wall-clock budget on this reprompt path are inherited from the existing mutation-directive reprompt and are not introduced or fixed here.
- This spec's own implement run executes against the installed daemon predating this fix, so it gets no benefit from the reprompt it lands — a keystone miss on this run's own subspec (if any) hard-blocks as before. Not a spec defect; noted so a stranded self-run isn't read as proof the fix failed.

## Task checklist

- [ ] Widen the shared mutation-checkpoint report-entry type with an optional resolved repo-relative `pinPath` field, populated on unlinked keystone checkpoint entries.
- [ ] Admit `Unlinked keystone checkpoints` as a reprompt-eligible `spec.criteria-ticked` miss, gated on unlinked keystones being the report's only blocking finding (a malformed directive on the named pin, a hollow guard, an inert headline, or any other blocking unparseable excludes reprompt).
- [ ] Add the `write.keystone-directive-reprompt` prompt artifact (registered in `prompts/registry.txt`) injecting the criterion, the resolved pin path, the active subspec path, and step rules.
- [ ] In prompt selection, check pending mutation-directive-reprompt context before pending keystone-directive-reprompt context; clear keystone context on the same terminal condition (settle or budget exhaustion) as the existing context.
- [ ] Log `keystone_directive_reprompt` at the progress boundary with the criterion and pin path; restore that context on resume from the last such log event (write loop input recovery plus daemon plumbing).
- [ ] Name the criterion and resolved pin path in the `Unlinked keystone checkpoints` exhaustion blocker.
- [ ] Update the docs listed below.

## Acceptance criteria

- [ ] An implement run whose ticked keystone criterion resolves its pin but links no directive is reprompted instead of settling, and completes when the next iteration lands the directive; test `unlinked keystone checkpoint reprompts before settle` in `v2/src/execution/write-loop.test.ts` fails against the pre-fix code (which settles `contract_miss` on the first pass) and passes after.
- [ ] The reprompt text names the criterion's first line and the resolved repo-relative pin path, and the run log carries a `keystone_directive_reprompt` event with the same criterion and pin path (a single pair, not an array).
- [ ] A report carrying both an unlinked keystone and a hollow guard checkpoint still hard-blocks, appending the harness `## Blocker` to the active subspec with no reprompt.
- [ ] A ticked keystone criterion whose named pin already carries a malformed (unparseable) directive still hard-blocks with both the `Unparseable mutation checkpoints:` and `Unlinked keystone checkpoints` blockers and no reprompt; test `malformed directive on named keystone pin hard-blocks without reprompt` in `v2/src/execution/write-loop.test.ts`.
- [ ] A ticked keystone criterion whose pin never resolves still hard-blocks with the unresolved pinning-test blocker, unchanged.
- [ ] A ticked keystone criterion still carrying no linked directive when the iteration budget is exhausted settles `contract_miss` with the `Unlinked keystone checkpoints` blocker naming the criterion's first line and the resolved pin path.
- [ ] A run paused after a keystone reprompt restores the criterion and pin path from the last `keystone_directive_reprompt` log event on resume, so the next iteration renders the same reprompt; test `resumes paused implement write loop with keystone-directive reprompt context from log` in `v2/src/daemon/daemon-resume.test.ts`.
- [ ] `write.keystone-directive-reprompt` is registered in `prompts/registry.txt`.
- [ ] `v2/src/execution/write.test.ts` mutation-checkpoint completion tests and `write-loop.test.ts` mutation-directive-reprompt tests stay green (guard, inert-headline, and existing unparseable-reprompt behavior unchanged).
- [ ] `v2/src/execution/write-loop.test.ts` — `unlinked keystone checkpoint reprompts before settle`; Keystone checkpoint: reverting the keystone-unlinked reprompt admission in the write loop to the pre-fix terminal settle turns this pin red.
- [ ] `v2/src/execution/write.test.ts` — `unlinked keystone miss is reprompt eligible`; Mutation checkpoint: inverting the `Unlinked keystone checkpoints` arm of `isRepromptEligibleMutationCheckpointMiss` turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `mixed hollow and unlinked keystone hard-blocks`; Mutation checkpoint: inverting the guard that excludes hollow, inert-headline, and blocking-unparseable findings from keystone reprompt admission turns this pin red, proving the suppressed reprompt is absent on mixed failure.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/prompts.md`, `v2/docs/workflow-runner.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` describe the keystone reprompt, its admission rule (including the malformed-directive-on-pin and prompt-precedence deferrals), resume replay, and the recovery path for a run that still strands on `Unlinked keystone checkpoints`.

## Documentation updates

- `v2/docs/write-behavior.md` — keystone-unlinked reprompt admission, budget, prompt precedence against the existing mutation-directive reprompt, and pause/resume replay.
- `v2/docs/prompts.md` — register `write.keystone-directive-reprompt` with its placeholders and usage scope.
- `v2/docs/workflow-runner.md` — the implement-link contract for keystone criteria: the plan names the pin, the implement lands the directive.
- `v2/docs/operator-runbook.md` — keystone criteria need a linkable directive, how greenfield keystones resolve after the implement writes the file, and recovery when a run still strands on `Unlinked keystone checkpoints` (including the malformed-directive-on-pin and mixed-miss cases that still hard-block).
- `v2/docs/v1-behaviors.md` — record the changed implement-completion behavior.
