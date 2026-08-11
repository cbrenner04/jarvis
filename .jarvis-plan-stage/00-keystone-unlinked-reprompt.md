# Unlinked keystone checkpoint reprompts the implement to author the directive

## Problem

Implement completion hard-blocks `spec.criteria-ticked` with `Unlinked keystone checkpoints (no directive linked on the named pin)` on the first miss: the miss is not reprompt-eligible (`isRepromptEligibleMutationCheckpointMiss` admits only `Unparseable mutation checkpoints:`), and the entry run is non-resumable, so the whole spec strands. Plans that phrase the keystone in prose — and greenfield subspecs whose pinning file does not exist at plan time — cannot carry a plan-time literal directive, so implementability depends on plan-agent variance rather than on the code and tests the implement lands (observed 2026-08-09, `tui-attention-segment-rows`, plan #2774).

## Behavior

When a ticked keystone criterion's pin resolves but carries no linked `// @mutate` directive, and that is the report's only blocking finding, the write loop reprompts the implement — naming the criterion and the resolved repo-relative pin path — and re-judges the contract on the next iteration, within `maxIterations`. Everything else is unchanged: an unresolved or ambiguous pin, a hollow guard, an inert headline, or any other blocking unparseable still hard-blocks with a harness `## Blocker`, and once a directive is linked the mutation verifier behaves as before.

## Decisions

- Keystone-unlinked reprompt reuses the loop's `maxIterations` budget; exhaustion settles the existing `Unlinked keystone checkpoints` blocker — rules out a dedicated keystone repair counter.
- New prompt `write.keystone-directive-reprompt` and new log event `keystone_directive_reprompt`, not reuse of `write.mutation-directive-reprompt` / `mutation_directive_reprompt` — the existing prompt says "retarget each directive" and its rows carry `reason: target_absent | target_ambiguous`, both of which presuppose a directive that does not exist here.
- Reprompt admits only when unlinked keystones are the report's sole blocking finding (no hollow, no inert headline, no blocking unparseable) — rules out reprompting on mixed failure, which would let a hollow guard ride along unreported.
- A keystone whose pin does not resolve (`unresolved_pinning_test`, `ambiguous_pinning_basename`) keeps hard-blocking — the implement did not write the named test, so there is nothing to author a directive on.
- No plan-draft change: keystone selection is by canonical suffix and never inspects on-disk directives, so a greenfield pin already drafts today; the gap is entirely at implement completion — rules out relaxing plan-draft or pre-authoring directives at plan time.
- `keystoneUnlinked` report entries carry the resolved repo-relative pin path so the reprompt can name the pin — rules out re-resolving the pin inside the write loop.

## Task checklist

- [ ] Record the resolved repo-relative pin path on unlinked keystone checkpoint entries.
- [ ] Admit `Unlinked keystone checkpoints` as a reprompt-eligible `spec.criteria-ticked` miss, gated on unlinked keystones being the report's only blocking finding.
- [ ] Add the `write.keystone-directive-reprompt` prompt artifact (registered in `prompts/registry.txt`) injecting the criterion, the resolved pin path, the active subspec path, and step rules.
- [ ] Log `keystone_directive_reprompt` at the progress boundary and restore that context on resume (write loop input recovery plus daemon plumbing).
- [ ] Update the docs listed below.

## Acceptance criteria

- [ ] An implement run whose ticked keystone criterion resolves its pin but links no directive is reprompted instead of settling, and completes when the next iteration lands the directive; test `unlinked keystone checkpoint reprompts before settle` in `v2/src/execution/write-loop.test.ts` fails against the pre-fix code (which settles `contract_miss` on the first pass) and passes after.
- [ ] The reprompt text names the criterion's first line and the resolved repo-relative pin path, and the run log carries a `keystone_directive_reprompt` event with the same criterion and pin path.
- [ ] A report carrying both an unlinked keystone and a hollow guard checkpoint still hard-blocks, appending the harness `## Blocker` to the active subspec with no reprompt.
- [ ] A ticked keystone criterion whose pin never resolves still hard-blocks with the unresolved pinning-test blocker, unchanged.
- [ ] A ticked keystone criterion still carrying no linked directive when the iteration budget is exhausted settles `contract_miss` with the `Unlinked keystone checkpoints` blocker.
- [ ] A run paused after a keystone reprompt restores the criterion and pin path from the last `keystone_directive_reprompt` log event on resume, so the next iteration renders the same reprompt.
- [ ] `v2/src/execution/write.test.ts` mutation-checkpoint completion tests and `write-loop.test.ts` mutation-directive-reprompt tests stay green (guard, inert-headline, and existing unparseable-reprompt behavior unchanged).
- [ ] `v2/src/execution/write-loop.test.ts` — `unlinked keystone checkpoint reprompts before settle`; Keystone checkpoint: reverting the keystone-unlinked reprompt admission in the write loop to the pre-fix terminal settle turns this pin red.
- [ ] `v2/src/execution/write.test.ts` — `unlinked keystone miss is reprompt eligible`; Mutation checkpoint: inverting the `Unlinked keystone checkpoints` arm of `isRepromptEligibleMutationCheckpointMiss` turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `mixed hollow and unlinked keystone hard-blocks`; Mutation checkpoint: inverting the guard that excludes hollow, inert-headline, and blocking-unparseable findings from keystone reprompt admission turns this pin red, proving the suppressed reprompt is absent on mixed failure.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/prompts.md`, `v2/docs/workflow-runner.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` describe the keystone reprompt, its admission rule, resume replay, and the recovery path for a run that still strands on `Unlinked keystone checkpoints`.

## Documentation updates

- `v2/docs/write-behavior.md` — keystone-unlinked reprompt admission, budget, and pause/resume replay alongside the existing mutation-directive reprompt.
- `v2/docs/prompts.md` — register `write.keystone-directive-reprompt` with its placeholders and usage scope.
- `v2/docs/workflow-runner.md` — the implement-link contract for keystone criteria: the plan names the pin, the implement lands the directive.
- `v2/docs/operator-runbook.md` — keystone criteria need a linkable directive, how greenfield keystones resolve after the implement writes the file, and recovery when a run still strands on `Unlinked keystone checkpoints`.
- `v2/docs/v1-behaviors.md` — record the changed implement-completion behavior.
