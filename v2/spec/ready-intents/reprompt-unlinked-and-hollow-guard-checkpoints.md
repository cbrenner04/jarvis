---
name: reprompt-unlinked-and-hollow-guard-checkpoints
---

# Reprompt Unlinked and Hollow Guard Checkpoints

## Prerequisites

- Implement write completion reprompts a sole unlinked keystone checkpoint within the shared `maxIterations` budget.
- Mutation-checkpoint verification distinguishes a guard with no linked directive from a linked directive whose mutation leaves the scoped suite green.

## Surface

Execution loop.

## Problem

Implement completion terminally settles resolvable unlinked and hollow guard checkpoints, stranding otherwise-correct greenfield work instead of giving the agent another iteration to repair the formal mutation link.

## Behavior

- Reprompt when every blocking finding is an unlinked or hollow guard checkpoint, optionally alongside an unlinked keystone checkpoint.
- Name every affected criterion, its resolved repo-relative pin path, and whether the directive is absent or its mutation left the scoped suite green.
- Tell the agent to add the missing directive for an unlinked guard or repair the directive or pinning test for a hollow guard, then re-judge completion on the next iteration.
- Complete after the next iteration repairs every finding; otherwise continue within the existing write-loop budget.
- Keep unresolved or ambiguous pins, inert headlines, genuinely unparseable directive bodies, and any mix containing another real failure terminal.

## Decisions

- Guard-checkpoint reprompts reuse `maxIterations`; rules out a separate repair counter.
- Guard-checkpoint context precedes keystone-only context when both are pending; rules out selecting a narrower prompt that omits guard repairs.
- A guard-plus-unlinked-keystone-only report is one eligible repair set; rules out the current mixed-checkpoint strand.
- Pending guard context clears on contract settle or iteration exhaustion; rules out leaking stale repair instructions into a terminal boundary.

## Required verification

- A pre-fix-failing write-loop test covers a sole unlinked guard completing after the next iteration authors its directive.
- A write-loop test covers a sole hollow guard completing after the next iteration makes its mutation turn the scoped suite red.
- Tests preserve terminal hard-blocks for unresolved or ambiguous pins, inert headlines, unparseable directive bodies, and mixed real failures.
- A lifecycle test pins shared-budget exhaustion, context clearing, and guard-before-keystone prompt precedence.

## Documentation updates

- `v2/docs/write-behavior.md` — canonical guard admission, unlinked-versus-hollow instructions, shared budget, prompt precedence, context clearing, and hard blocks.
- `v2/docs/workflow-runner.md` — cross-link the implement-completion discussion to the canonical guard-repair contract without duplicating loop semantics.
- `v2/docs/v1-behaviors.md` — parity-catalog entry that links to the canonical contract and records widened fresh-write-loop reprompts and preserved hard blocks.
