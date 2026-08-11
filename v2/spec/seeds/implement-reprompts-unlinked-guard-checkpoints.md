---
name: implement-reprompts-unlinked-guard-checkpoints
---

# Implement reprompts the agent to author unlinked guard mutation directives

## Problem

Implement completion hard-blocks `spec.criteria-ticked` on an unlinked or hollow guard (`Mutation checkpoint:`) directive with no reprompt, stranding the run non-resumably. #2827 added a write-loop reprompt only for unlinked *keystone* checkpoints, and only when a keystone is the report's sole blocking finding; guard checkpoints were an explicit deferral. Greenfield agents (observed repeatedly with claude) reliably write the code and the tests but omit the `// @mutate` directives that link criteria to tests.

Observed 2026-08-11: the `ready-gate-reaps-test-children` subspec 01 implement wrote correct, green code (regression + unit tests passing per the agent, typecheck clean) but stranded `blocked`/`contract_miss` because the agent authored no directive for its 1 keystone + 2 guard checkpoints. Even with #2827 live, the two guards would still hard-block, so the run strands regardless. The whole spec tree was lost to a formal-linkage gap, not a code defect.

## Decisions

- Extend the write-loop reprompt (the #2827 seam) to unlinked/hollow guard (`Mutation checkpoint:`) findings: when the report's only blocking findings are unlinked or hollow guard checkpoints (and/or an unlinked keystone), reprompt the agent — naming each criterion and its resolved pin path — to author the missing `// @mutate` directive on the named pin, then re-judge within `maxIterations`. Rules out the current keystone-only reprompt that leaves guards terminal.
- A hollow guard (directive present but the mutation left the scoped suite green) is reprompt-eligible the same as an unlinked one: the reprompt tells the agent the named mutation did not redden its test and to fix the directive or the test. Rules out treating hollow-but-present as unfixable.
- Preserve every existing hard-block: an unresolved/ambiguous pin, an inert headline, a genuinely unparseable directive body, or a mixed miss with a real non-checkpoint failure still hard-blocks. Rules out reprompting past a real defect.
- Budget/lifecycle mirror #2827 exactly (shared `maxIterations`, context cleared on settle or exhaustion, precedence pinned deterministically). Rules out a separate counter.

## Secondary observation (for the ready-gate-reaps re-plan, not this seed)

Subspec 01 of `20260811T063011Z-ready-gate-reaps-test-children` is additionally hard to check because the ready gate and required-integration spawn sites in `ready-finalize.ts` have byte-identical option lines (`processGroup: {}`, the signal spread), so no unique single-line `@mutate` anchor exists for "the gate's spawn" vs "the required-integration spawn". A reprompt cannot invent a unique anchor where none exists; that subspec's checkpoints need a re-plan that either differentiates the two spawn sites or targets distinct source lines. Not in scope here.

## Acceptance criteria

- [ ] An implement whose only blocking finding is an unlinked guard mutation checkpoint (pin resolves, no directive) is reprompted to author the directive and completes when the next iteration lands it, rather than settling `contract_miss`; pinned by a write-loop test that fails against the pre-fix (keystone-only) reprompt.
- [ ] An implement whose only blocking finding is a hollow guard checkpoint (directive present, mutation left the suite green) is reprompted with the hollow reason and completes when the next iteration fixes it; pinned by a write-loop test.
- [ ] A guard checkpoint whose pin does not resolve, an inert headline, an unparseable directive body, or a mixed miss with a real failure still hard-blocks unchanged; pinned by tests.
- [ ] The guard reprompt reuses the `maxIterations` budget and clears its context on settle/exhaustion, with deterministic precedence against the keystone reprompt context; pinned by a resume/lifecycle test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the guard reprompt: admission rule, hollow-vs-unlinked handling, budget, precedence vs the keystone reprompt, resume replay.
- `v2/docs/workflow-runner.md` — implement now authors missing guard directives on reprompt, not only keystones.
- `v2/docs/v1-behaviors.md` — record the widened reprompt behavior.
