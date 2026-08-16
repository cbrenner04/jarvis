---
name: guard-checkpoints-link-implement-authored-directive
---

# Guard checkpoint criteria are satisfied by the directive the implement lands

## Problem

Implement completion hard-blocks `spec.criteria-ticked` on an unlinked or hollow guard (`Mutation checkpoint:`) criterion with no reprompt, stranding the entry run non-resumably. #2827 (`keystone-links-implement-authored-directive`) added a write-loop reprompt only for an unlinked *keystone* checkpoint, and only when a single keystone is the report's sole blocking finding; guard checkpoints were an explicit deferral. Greenfield agents (observed repeatedly with claude) reliably write the code and the tests but omit the `// @mutate` directives that link criteria to those tests, so a whole spec tree is lost to a formal-linkage gap rather than a code defect (observed 2026-08-11 on `ready-gate-reaps-test-children` subspec 01: green code and tests, no directive for its 1 keystone + 2 guard checkpoints).

## Behavior

When a report's only blocking findings are unlinked guard checkpoints (pin resolves, no linked directive) and/or hollow guard checkpoints (a directive is linked but its mutation left the scoped suite green), optionally alongside a single unlinked keystone checkpoint, the write loop reprompts the implement — naming each affected criterion, its resolved repo-relative pin path, and whether the directive is absent (unlinked) or inert (hollow) — and re-judges the contract on the next iteration, within the shared `maxIterations` budget. An unlinked guard is told to author the missing directive on the named pin; a hollow guard is told its named mutation did not redden the pinning test and to fix the directive or the test. Everything else is unchanged: an unresolved or ambiguous pin, an inert headline, a genuinely unparseable directive body, or any mixed miss that also carries a real non-checkpoint failure still hard-blocks with a harness `## Blocker`, and once a directive is correctly linked the mutation verifier behaves as before.

## Prerequisites

- Implement completion runs the `spec.criteria-ticked` contract and refuses ticked guard (`Mutation checkpoint:`) criteria whose pin carries no linked `// @mutate` directive, and hollow guards whose linked mutation leaves the scoped suite green.
- The mutation-checkpoint verifier resolves a criterion's pinning test path and distinguishes unlinked from hollow guard misses.
- The write loop reprompts a sole unlinked keystone checkpoint (the #2827 seam) with directive context recovered from the run log, on the shared `maxIterations` budget, clearing that context on settle or exhaustion.

## Decisions

- Extend the #2827 reprompt seam to guard misses rather than adding a parallel counter or loop; guard and keystone reprompts share `maxIterations`, and guard context clears on the same terminal condition (contract settle or budget exhaustion) as keystone context.
- Guard-checkpoint reprompt context precedes keystone-only context when both would be pending in the same iteration, so a guard repair is never dropped in favor of a narrower keystone-only prompt; precedence is pinned deterministically even where same-iteration contention does not arise today.
- A hollow guard (directive present, mutation inert) is reprompt-eligible on the same footing as an unlinked one — rules out treating hollow-but-present as unfixable.
- Preserve every existing hard-block unchanged: unresolved/ambiguous pin, inert headline, unparseable directive body, and any mixed miss carrying a real non-checkpoint failure.
- Durability mirrors #2827: persist one structured guard-checkpoint reprompt log event carrying every eligible finding's criterion, resolved pin path, and unlinked-or-hollow reason, without changing existing mutation-directive or keystone-directive event shapes; daemon resume reconstructs the newest directive-reprompt context across all kinds (mutation / guard / keystone) from the durable log tail without resetting the consumed-iteration count.

## Documentation updates

- `v2/docs/write-behavior.md` — the guard reprompt: admission rule, unlinked-vs-hollow instructions, shared budget, precedence vs the keystone reprompt, context clearing, durable event, and pause/resume replay.
- `v2/docs/workflow-runner.md` — the implement-link contract now covers guard criteria: the plan names the pin, the implement lands the directive.
- `v2/docs/v1-behaviors.md` — record the widened implement-completion reprompt (guards, not only keystones) and preserved hard blocks.
