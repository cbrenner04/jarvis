# Guard checkpoint misses reprompt the implement

## Problem

Implement completion terminally settles `spec.criteria-ticked` when resolved guard findings lack a directive or name inert mutations, stranding green implementation work over formal evidence.

## Behavior

When all blocking entries are eligible guard findings, optionally with one unlinked keystone, the write loop emits one durable guard event and reprompts within `maxIterations`. The prompt names every criterion, resolved pin, reason, and hollow mutation identity; it directs unlinked repairs to author a directive on the pin and hollow repairs to make the named mutation redden the pinning test. Any other hard finding settles with the existing blocker.

## Decision ledger

- Add `write.guard-checkpoint-reprompt` and `guard_checkpoint_reprompt` with structured findings — rules out changing existing mutation-directive or keystone-directive shapes.
- Admit only guards plus at most one unlinked keystone — rules out widening repair to unresolved pins, inert headlines, malformed directives, or mixed hard failures.
- Select pending contexts in `mutation-directive → guard-checkpoint → keystone-directive` order — rules out dropping a broader guard repair or violating existing mutation repair precedence.
- Preserve guard context across ordinary `progress`; clear it on success, terminal contract miss, or exhaustion — rules out stale repair prompts or a parallel counter.

## Tasks

- [ ] Add guard-only admission, shared-budget continuation, context lifecycle, deterministic pending-context precedence, and structured run-log emission to the implement write loop.
- [ ] Add and register the guard-checkpoint prompt with reason-specific repair instructions and hollow mutation identity.
- [ ] Verify durable append/readback for the guard event and preserved hard-block behavior.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [ ] `unlinked and hollow guard checkpoints reprompt before settle` in `v2/src/execution/write-loop.test.ts` drives multiple eligible guards, fails against the pre-fix terminal settle, and passes when the next iteration lands working directives.
- [ ] The guard prompt and persisted `guard_checkpoint_reprompt` event list every finding's criterion, resolved repo-relative pin, `unlinked` or `hollow` reason, and hollow mutation identity; unlinked copy asks for a directive on the pin, while hollow copy asks to repair the named directive or pinning test so its mutation reddens it.
- [ ] `guard checkpoint reprompt event survives durable append and readback` in `v2/src/execution/write-loop.test.ts` proves the structured finding payload is unchanged after log persistence.
- [ ] `guard context lifecycle survives progress and clears on terminal outcomes` in `v2/src/execution/write-loop.test.ts` directly covers survival across ordinary `progress` and clearing on success, terminal hard miss, and exhaustion.
- [ ] `pending directive-reprompt precedence is mutation then guard then keystone` in `v2/src/execution/write-loop.test.ts` installs all three pending contexts together and proves actual selection order, including guard before keystone.
- [ ] `guard repair leaves one unlinked keystone for the next contract judgment` in `v2/src/execution/write-loop.test.ts` proves the guard prompt comes first, the unchanged keystone then uses the existing keystone prompt, and both repairs consume the same `maxIterations` budget.
- [ ] Eligible guard findings at budget exhaustion settle `contract_miss` with the existing guard blocker details and no extra iteration.
- [ ] `guard checkpoint reprompt excludes mixed hard findings` in `v2/src/execution/write-loop.test.ts` fails against pre-fix admission and proves unresolved or ambiguous pins, inert headlines, malformed directives, and any mixed hard finding append a harness `## Blocker` without a guard reprompt.
- [ ] `hollow guard miss is reprompt eligible` in `v2/src/execution/write.test.ts` stays green when a linked mutation is inert.
- [ ] `mutation-directive reprompt persists after guard support` and `sole unlinked keystone reprompts the implement` in `v2/src/execution/write-loop.test.ts` stay green, including their event payload shapes.
- [ ] `write.guard-checkpoint-reprompt` is registered in `prompts/registry.txt` and documented in `v2/docs/prompts.md`.
- [ ] `v2/src/execution/write-loop.test.ts` — `unlinked and hollow guard checkpoints reprompt before settle`; Keystone checkpoint: restoring the pre-fix terminal settle turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `guard checkpoint reprompt excludes mixed hard findings`; Mutation checkpoint: inverting hard-finding exclusion turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `pending directive-reprompt precedence is mutation then guard then keystone`; Mutation checkpoint: inverting either adjacent precedence arm turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `guard repair leaves one unlinked keystone for the next contract judgment`; Mutation checkpoint: inverting guard-before-keystone continuation turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `guard context lifecycle survives progress and clears on terminal outcomes`; Mutation checkpoint: inverting a lifecycle clearing or retention guard turns this pin red.
- [ ] Every added or modified admission, precedence, lifecycle, prompt, and event-persistence guard has an in-test `// @mutate` directive on the real source branch whose inversion turns its named regression red.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/workflow-runner.md`, and `v2/docs/v1-behaviors.md` describe the guard implement-link contract, admission and preserved hard blocks, reason-specific instructions, shared budget, precedence, clearing, durable event, and pause/resume replay.

## Documentation updates

- `v2/docs/write-behavior.md` — guard admission, instructions, shared budget, precedence, clearing, event, and replay.
- `v2/docs/prompts.md` — `write.guard-checkpoint-reprompt` placeholders and scope.
- `v2/docs/workflow-runner.md` — guard criteria name the pin and the implement lands the directive.
- `v2/docs/v1-behaviors.md` — widened guard reprompt and preserved hard blocks.
