# Guard checkpoint misses reprompt the implement

## Problem

Implement completion terminally settles `spec.criteria-ticked` when a resolved guard checkpoint has no linked directive or its linked mutation leaves the scoped suite green. Green code and tests therefore strand when the implement omits or misauthors formal guard evidence.

## Behavior

When every blocking report entry is an unlinked or hollow guard checkpoint, optionally with one unlinked keystone, the write loop reprompts within the existing `maxIterations` budget. The prompt lists every guard criterion, resolved repo-relative pin path, and `unlinked` or `hollow` reason; it tells the implement to add a missing directive or repair the inert directive/test, then re-runs the completion contract. Existing unresolved or ambiguous pins, inert headlines, unparseable directives, and other mixed hard failures still append the harness blocker and settle.

## Decision ledger

- Add `write.guard-checkpoint-reprompt` and `guard_checkpoint_reprompt` with an array of `{ criterionText, pinPath, reason: "unlinked" | "hollow" }` findings — rules out changing the existing mutation-directive or keystone-directive prompt/event shapes.
- Populate the resolved pin path on both unlinked and hollow guard report entries — rules out reconstructing a pin from criterion prose after verification.
- Keep prompt precedence `mutation-directive → guard-checkpoint → keystone-directive`; a guard report that also contains an unlinked keystone emits guard context first and lets the next contract judgment route any remaining keystone miss — rules out dropping guard repair for the narrower single-keystone prompt or combining event schemas.
- Reuse ordinary write iterations and `maxIterations`; guard context persists across `progress` and clears on completion, terminal contract miss, or exhaustion — rules out a repair counter or stale prompt context.
- Admit only guard findings plus at most one unlinked keystone; every other blocking report entry retains its current hard-block path — rules out widening repair to unresolved pins, inert headlines, malformed directives, or mixed hard failures.

## Tasks

- [ ] Project eligible guard report entries into structured reprompt findings with criterion, resolved pin path, and reason.
- [ ] Add guard-only admission, shared-budget continuation, deterministic prompt precedence, context clearing, and structured run-log emission to the implement write loop.
- [ ] Add and register the guard-checkpoint prompt with reason-specific repair instructions.
- [ ] Cover pure unlinked, pure hollow, multiple guards, accompanying unlinked keystone, exhaustion, and preserved hard-block cases.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [ ] `unlinked and hollow guard checkpoints reprompt before settle` in `v2/src/execution/write-loop.test.ts` drives multiple eligible guards, fails against the pre-fix terminal settle, and passes when the next iteration lands working directives.
- [ ] The guard prompt and `guard_checkpoint_reprompt` run-log event list every eligible guard's criterion, resolved repo-relative pin path, and `unlinked` or `hollow` reason; unlinked copy asks for a directive on the pin, while hollow copy asks to repair the directive or pinning test so the mutation reddens it.
- [ ] An eligible guard report accompanied by one unlinked keystone renders the guard prompt first; after guard repair, an unchanged keystone routes through the existing keystone prompt on the next contract judgment, with both repairs consuming the same `maxIterations` budget.
- [ ] Eligible guard findings still present at budget exhaustion settle `contract_miss` with the existing guard blocker details and no extra iteration.
- [ ] Unresolved or ambiguous pins, inert headlines, unparseable directive bodies, and guard reports mixed with any other hard finding still append a harness `## Blocker` and emit no guard reprompt.
- [ ] Existing mutation-directive and pure keystone reprompt tests stay green, including their event payload shapes and precedence.
- [ ] `write.guard-checkpoint-reprompt` is registered in `prompts/registry.txt` and documented in `v2/docs/prompts.md`.
- [ ] `v2/src/execution/write-loop.test.ts` — `unlinked and hollow guard checkpoints reprompt before settle`; Keystone checkpoint: restoring the pre-fix terminal settle turns this pin red.
- [ ] `v2/src/execution/write.test.ts` — `hollow guard miss is reprompt eligible`; Mutation checkpoint: inverting the guard-miss eligibility arm turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `guard checkpoint reprompt excludes mixed hard findings`; Mutation checkpoint: inverting the hard-finding exclusion makes the suppressed reprompt observable and turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `guard checkpoint reprompt precedes an accompanying unlinked keystone`; Mutation checkpoint: inverting guard-before-keystone precedence turns this pin red.
- [ ] Every added or modified eligibility, finding-reason, precedence, clearing, and budget guard has an in-test `// @mutate` directive on the real source branch whose inversion turns its named regression red.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/workflow-runner.md`, and `v2/docs/v1-behaviors.md` describe the guard implement-link contract, admission and preserved hard blocks, reason-specific instructions, shared budget, precedence, clearing, and structured event.

## Documentation updates

- `v2/docs/write-behavior.md` — guard admission, instructions, shared budget, precedence, clearing, and event.
- `v2/docs/prompts.md` — `write.guard-checkpoint-reprompt` placeholders and scope.
- `v2/docs/workflow-runner.md` — guard criteria name the pin and the implement lands the directive.
- `v2/docs/v1-behaviors.md` — widened guard reprompt and preserved hard blocks.
