# Reprompt repairable guard checkpoints

## Problem

Implement completion terminally settles a guard criterion whose resolved pin has no linked `// @mutate` directive or whose linked mutation leaves the scoped suite green. Greenfield work can therefore satisfy its runtime behavior and tests yet strand before the implement gets one iteration to repair the formal checkpoint evidence.

## Behavior

When every blocking finding is an unlinked or hollow guard checkpoint, optionally with an unlinked keystone, the implement write loop reprompts with every criterion, resolved repo-relative pin path, and `unlinked` or `hollow` reason. The prompt tells the implement to add a missing directive or repair the directive or pinning test so the mutation turns the scoped suite red, then completion re-verifies the report on the next iteration within the existing `maxIterations` budget. Unresolved or ambiguous pins, inert headlines, blocking unparseable directives, and any report containing another real failure remain terminal.

## Decisions

- Use one structured guard-repair context containing all eligible guard findings and any accompanying unlinked keystone, with reason `"unlinked"` or `"hollow"` per finding; rules out a single-finding prompt or a keystone-only prompt that omits other repairs.
- Add `write.guard-checkpoint-reprompt` instead of reusing the mutation-directive or keystone prompt; rules out instructions that only retarget an existing directive or only repair one keystone.
- Guard-repair admission requires at least one guard finding and zero inert-headline or blocking-unparseable findings; rules out widening reprompts for unresolved pins, ambiguous pins, malformed bodies, unresolvable target paths, or mixed real failures.
- Guard-repair admission may include an unlinked keystone and owns that combined repair set; rules out the current guard-plus-keystone terminal strand.
- Guard context wins over pending keystone-only context and all sibling directive-reprompt contexts are cleared when a new arm records its miss; rules out rendering stale or narrower repair instructions.
- Guard-repair attempts consume `maxIterations`, and process-local context is dropped when the loop completes, terminally misses, or exhausts; rules out a separate repair budget or context crossing a terminal boundary.
- Keep guard context process-local in this subspec; rules out folding the separately queued run-log persistence and daemon-resume changes into this execution-loop patch.

## Task checklist

- [ ] Populate the resolved repo-relative pin path on every unlinked or hollow guard report entry while preserving the existing directive-present distinction.
- [ ] Admit guard-only and guard-plus-unlinked-keystone reports to a shared structured guard-repair context; keep every other blocking report terminal.
- [ ] Add and register `write.guard-checkpoint-reprompt`, rendering every finding with its criterion, pin path, and reason plus the reason-specific repair instruction.
- [ ] Thread guard context through fresh write-loop prompt selection, give it precedence over keystone-only context, clear superseded sibling contexts, and clear it at settle or exhaustion.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [ ] An implement run with one unlinked guard is reprompted instead of settling and completes after the next iteration adds a linked directive; test `unlinked guard checkpoint reprompts before settle` in `v2/src/execution/write-loop.test.ts` fails against the pre-fix code and passes after.
- [ ] An implement run with one linked guard whose mutation leaves the scoped suite green is reprompted and completes after the next iteration makes that mutation turn the suite red; test `hollow guard checkpoint reprompts before settle` in `v2/src/execution/write-loop.test.ts` fails against the pre-fix code and passes after.
- [ ] One reprompt names every eligible guard and accompanying unlinked keystone with its criterion, resolved repo-relative pin path, and `unlinked` or `hollow` reason; the prompt gives the matching add-directive or repair-directive-or-pin instruction.
- [ ] A guard plus an unlinked keystone is one eligible repair set and completes only after the next iteration repairs both; test `guard and unlinked keystone reprompt together` in `v2/src/execution/write-loop.test.ts` fails against the pre-fix terminal mixed-checkpoint behavior.
- [ ] Unresolved and ambiguous pins, inert headlines, malformed or otherwise blocking unparseable directives, and a guard mixed with any such finding still settle `contract_miss` with no guard reprompt; test `guard checkpoint reprompt rejects mixed real failures` in `v2/src/execution/write-loop.test.ts` covers each case.
- [ ] Guard repairs consume the existing iteration budget, exhaustion appends the original checkpoint blocker, completion and terminal misses clear pending guard context, and guard context precedes a simultaneously pending keystone-only context; test `guard checkpoint reprompt lifecycle uses shared budget and precedence` in `v2/src/execution/write-loop.test.ts` covers the lifecycle.
- [ ] `write.guard-checkpoint-reprompt` is registered in `prompts/registry.txt`, and its prompt contract is covered in `v2/src/execution/write-prompt.test.ts`.
- [ ] Existing tests `target_absent mutation directive reprompts before settle`, `unlinked keystone checkpoint reprompts before settle`, and `a mutation-directive reprompt context does not mask a later pure keystone miss` in `v2/src/execution/write-loop.test.ts` stay green.
- [ ] `v2/src/execution/write-loop.test.ts` — `unlinked guard checkpoint reprompts before settle`; Keystone checkpoint: reverting guard-checkpoint reprompt admission to terminal settlement turns this pin red.
- [ ] `v2/src/execution/write.test.ts` — `hollow guard miss is reprompt eligible`; Mutation checkpoint: inverting the coarse `Hollow mutation checkpoints` reprompt-eligibility guard turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `guard checkpoint reprompt rejects mixed real failures`; Mutation checkpoint: directives invert each added exclusion guard, and each negative case proves the guard prompt and progress boundary remain absent.
- [ ] `v2/src/execution/write-loop.test.ts` — `guard checkpoint reprompt lifecycle uses shared budget and precedence`; Mutation checkpoint: directives invert each added budget, guard-before-keystone precedence, and sibling-context clearing guard; negative cases prove exhaustion emits no extra prompt or progress boundary, the narrower keystone prompt is absent, and stale sibling instructions do not render.
- [ ] `v2/docs/write-behavior.md` canonically describes guard admission, per-finding instructions, shared budget, prompt precedence, process-local context clearing, and preserved hard blocks; `v2/docs/prompts.md` records the prompt contract; `v2/docs/workflow-runner.md` cross-links implement completion to that contract without duplicating loop semantics; `v2/docs/v1-behaviors.md` records the widened fresh-loop reprompt and preserved hard blocks.

## Documentation updates

- `v2/docs/write-behavior.md` — canonical guard admission, finding reasons and instructions, shared budget, prompt precedence, process-local context clearing, and hard blocks.
- `v2/docs/prompts.md` — `write.guard-checkpoint-reprompt` placeholders and usage scope.
- `v2/docs/workflow-runner.md` — cross-link implement completion to the canonical guard-repair contract without duplicating loop semantics.
- `v2/docs/v1-behaviors.md` — update the parity catalog with widened fresh-write-loop reprompts and preserved hard blocks.
