# Reprompt repairable guard checkpoints

## Problem

Implement completion terminally settles a repairable guard report, stranding otherwise-correct greenfield work before the implement gets one iteration to repair its formal checkpoint evidence.

## Behavior

When every blocker is an `unlinked` or `hollow` guard finding, optionally with unlinked keystones, the fresh implement write loop reprompts with the whole repair set. Each guard names its criterion, resolved repo-relative pin path, reason, and, when hollow, its linked directive identity; it instructs the implement to add a directive when absent or repair the named directive or pinning test when hollow. Each unlinked keystone names its criterion and pin path, is labeled `keystone` with reason `unlinked`, and instructs the implement to add a headline-revert directive. Completion judges the next iteration within the existing `maxIterations` budget.

Pure `target_absent` or `target_ambiguous` reports keep their existing mutation-directive reprompt. A guard report mixed with either target finding, an unresolved or ambiguous pin, inert headline, blocking unparseable directive, or another real failure settles terminally as `contract_miss` without a guard repair prompt.

## Decisions

- Admit one structured guard-repair context only when it contains at least one guard and otherwise only unlinked keystones; rules out a single-finding prompt and the current guard-plus-keystone terminal strand.
- Add `write.guard-checkpoint-reprompt` rather than reuse the mutation-directive or keystone prompt; rules out guard instructions for an unlinked keystone or omission of another repair.
- Preserve the existing pure `target_absent` and `target_ambiguous` mutation-directive arm, but make either target finding terminal when mixed with a guard repair set; rules out accidentally widening a mixed report.
- Guard context wins over a pending keystone-only context. Re-arming any repair arm clears sibling contexts; rules out stale or narrower instructions in a later prompt.
- Guard repairs consume `maxIterations`; exhaustion appends the latest completion report's normal checkpoint blocker and starts no extra iteration. Terminal settlement emits no repair prompt; rules out a separate budget or an observable stale-context leak.
- Keep repair context process-local; run-log persistence and daemon-resume work remain out of scope.

## Task checklist

- [ ] Admit guard-only and guard-plus-unlinked-keystone reports to a shared structured guard-repair context; keep every mixed real failure terminal while preserving pure target-finding mutation-directive reprompts.
- [ ] Add and register `write.guard-checkpoint-reprompt`, rendering every entry's checkpoint kind, criterion, pin path, reason, linked-directive identity where applicable, and reason-specific repair instruction.
- [ ] Thread guard context through fresh write-loop prompt selection, give it precedence over keystone-only context, clear superseded sibling contexts when an arm changes, and clear it before observable terminal boundaries.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [ ] An implement run with one unlinked guard is reprompted instead of settling and completes after the next iteration adds a linked directive; test `unlinked guard checkpoint reprompts before settle` in `v2/src/execution/write-loop.test.ts` fails against the pre-fix code and passes after.
- [ ] An implement run with one linked guard whose mutation leaves the scoped suite green is reprompted and completes after the next iteration makes that mutation turn the suite red; test `hollow guard checkpoint reprompts before settle` in `v2/src/execution/write-loop.test.ts` fails against the pre-fix code and passes after.
- [ ] One prompt aggregates several guard findings with both `unlinked` and `hollow` reasons, naming every criterion and resolved repo-relative pin path, the hollow finding's directive `path:line` and text, and the matching add-directive or repair-directive-or-pin instruction; test `multiple guard checkpoint repairs aggregate with reasons` in `v2/src/execution/write-loop.test.ts` fails against the pre-fix code and passes after.
- [ ] A guard plus an unlinked keystone is one eligible repair set and completes only after the next iteration repairs both; the prompt names both criteria and resolved pin paths, labels their distinct kinds and reasons, and gives the keystone headline-revert directive guidance; test `guard and unlinked keystone reprompt together` in `v2/src/execution/write-loop.test.ts` fails against the pre-fix terminal mixed-checkpoint behavior.
- [ ] A guard mixed with an unresolved or ambiguous pin, `target_absent`, `target_ambiguous`, inert headline, malformed or otherwise blocking unparseable directive, or any other real failure settles `contract_miss` with no guard reprompt, while pure `target_absent` and `target_ambiguous` reports retain their mutation-directive reprompt; test `guard checkpoint reprompt rejects mixed real failures` in `v2/src/execution/write-loop.test.ts` covers each case.
- [ ] Guard repairs consume the existing iteration budget: exhaustion starts no extra iteration and appends the latest completion report's normal checkpoint blocker; guard context precedes a simultaneously pending keystone-only context; re-arming another repair arm renders no stale sibling instructions; and terminal settlement renders no repair prompt. Test `guard checkpoint reprompt lifecycle uses shared budget and precedence` in `v2/src/execution/write-loop.test.ts` covers these observable outcomes.
- [ ] `write.guard-checkpoint-reprompt` is registered in `prompts/registry.txt`, and its prompt contract is covered in `v2/src/execution/write-prompt.test.ts`.
- [ ] Existing tests `target_absent mutation directive reprompts before settle`, `unlinked keystone checkpoint reprompts before settle`, and `a mutation-directive reprompt context does not mask a later pure keystone miss` in `v2/src/execution/write-loop.test.ts` stay green.
- [ ] `v2/src/execution/write-loop.test.ts` — `unlinked guard checkpoint reprompts before settle`; Keystone checkpoint: reverting guard-checkpoint reprompt admission to terminal settlement turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `multiple guard checkpoint repairs aggregate with reasons`; Mutation checkpoint: directives invert each added guard-repair admission, directive-present-versus-absent reason classification, and per-kind reason-instruction selection guard, and the aggregation pin turns red.
- [ ] `v2/src/execution/write-loop.test.ts` — `guard checkpoint reprompt rejects mixed real failures`; Mutation checkpoint: directives invert each added mixed-report exclusion guard, and every negative case proves the guard prompt and progress boundary remain absent.
- [ ] `v2/src/execution/write-loop.test.ts` — `guard checkpoint reprompt lifecycle uses shared budget and precedence`; Mutation checkpoint: directives invert each added budget, guard-before-keystone precedence, and sibling-context-clearing guard; negative cases prove exhaustion emits no extra iteration or progress boundary, the narrower keystone prompt is absent, stale sibling instructions do not render, and terminal settlement emits no repair prompt.
- [ ] `v2/docs/write-behavior.md` canonically describes guard admission, per-finding and per-kind instructions, shared budget, prompt precedence, observable terminal clearing, preserved hard blocks, and the pure-target exception; `v2/docs/prompts.md` records the prompt contract; `v2/docs/workflow-runner.md` cross-links implement completion to that contract without duplicating loop semantics; `v2/docs/v1-behaviors.md` records the widened fresh-loop reprompt and preserved hard blocks.

## Documentation updates

- `v2/docs/write-behavior.md` — canonical guard admission, finding kinds, reasons and instructions, shared budget, prompt precedence, observable terminal clearing, pure-target exception, and hard blocks.
- `v2/docs/prompts.md` — `write.guard-checkpoint-reprompt` placeholders and usage scope.
- `v2/docs/workflow-runner.md` — cross-link implement completion to the canonical guard-repair contract without duplicating loop semantics.
- `v2/docs/v1-behaviors.md` — update the parity catalog with widened fresh-write-loop reprompts, pure-target behavior, and preserved hard blocks.
