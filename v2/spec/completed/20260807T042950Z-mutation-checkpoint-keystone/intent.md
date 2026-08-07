---
name: mutation-checkpoint-keystone
---

# Implement completion refuses inert headline changes via keystone mutation checkpoints

A guard against an unreachable condition cannot be killed by mutation; a headline behavior change that does nothing cannot be caught by guard pins alone. This intent adds a keystone `// @mutate` directive that reverts the subspec's core change to baseline semantics; a surviving keystone means the shipped change is inert.

## Decisions

- Every runtime-behavior subspec whose headline change is not docs-only carries one keystone `// @mutate` directive reverting that headline to baseline semantics — rules out shipping a no-op that passes its own guard tests.
- Keystone vs guard pin at selection: guard pins remain ticked non-human criteria selected by `Mutation checkpoint:` or directive-shaped `@mutate`; keystones are selected only via a dedicated `Keystone checkpoint:` criterion prefix on exactly one non-human criterion per runtime-behavior subspec — `@mutate` in the block links the pin only, not alternate selection — rules out guard-pin selection accidentally treating a headline revert as a guard hollow.
- Plan draft authors the keystone criterion and its pinning-test `// @mutate` directive when drafting runtime-behavior subspecs; completion refuses when ticked guard mutation-checkpoint criteria exist and zero ticked `Keystone checkpoint:` criteria — rules out the implement agent inventing or omitting the keystone silently; headline-only missing-keystone refusal and plan-draft validator deferred until enforcement scope expands.
- Keystone verification reuses `verifyMutationCheckpoints` apply/run/restore machinery unchanged — rules out a parallel verifier; keystone selection and inert-refusal policy land in the verifier branch keyed on `Keystone checkpoint:` criteria; verifier runs when guard count is zero.
- A keystone directive whose scoped suite stays green after apply is refused at completion with a named blocker distinct from hollow guard checkpoint blockers — rules out operators treating inert change as a proof-form guard problem.
- A keystone that turns its named test red completes normally; a subspec with guard checkpoints but no keystone is refused rather than silently passing; >1 ticked keystone criteria refused with distinct messaging — rules out guard-only coverage of headline changes and ambiguous revert targets.
- Full-diff revert is not the mechanism: new tests import new exports, so reverting everything yields compile errors rather than red tests — rules out whole-subspec revert as the keystone shape.
- Out of scope: intent-split prompt; phrase-only mutation-checkpoint selection path; headline-only missing-keystone enforcement without guard checkpoints.

## Acceptance criteria

- [ ] `v2/src/execution/mutation-checkpoint-keystone.test.ts` drives completion over an embedded fixture subspec whose keystone directive survives its mutation and asserts a named inert-headline blocker distinct from hollow guard checkpoint text; fails against the pre-fix completion boundary.
- [ ] `v2/src/execution/mutation-checkpoint-keystone.test.ts` asserts a keystone directive that turns its named test red completes normally, a subspec with guard checkpoints but no `Keystone checkpoint:` criterion is refused rather than silently passing, and >1 ticked keystone criteria are refused with distinct messaging; fails pre-fix.
- [ ] Mutation checkpoint: in `v2/src/execution/mutation-checkpoint-keystone.test.ts`, the test titled `refuses completion when keystone mutation survives` carries a `// @mutate` directive removing the keystone-survival refusal; the mutation turns that test RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:shared`, and `bun run test:v2` exit zero.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — keystone checkpoints alongside guard checkpoints for headline behavior changes; guard-gated missing-keystone refusal (headline-only enforcement deferred).
- `v2/docs/operator-runbook.md` § Gate trust — a surviving keystone means an inert headline change; distinguish from hollow guard checkpoints and from premise-smell hollow (second hollow on a different guard); manual headline-revert bullet deleted or demoted.
- `v2/docs/v1-behaviors.md` — implement completion refuses inert headline changes when a `Keystone checkpoint:` directive survives its mutation; missing keystone when guard checkpoints exist is refused; >1 ticked keystone criteria refused.

## Prerequisites

- Plan debate review flags invariant criteria whose violation is unreachable on the repository base as unfalsifiable during debate review.
- Plan debate review reports dropped unfalsifiable premises that would empty a subspec rather than inventing filler scope.
- `REVIEW_PASS_CONTEXT` composes `## Unfalsifiable premises` with `## At-risk hollow pins` non-destructively.
- `verifyMutationCheckpoints` selects ticked non-human criteria, parses `// @mutate` directives from pinning tests, applies mutations, runs classified scoped suites, refuses surviving guard mutations as hollow, and restores source in-process (`mutation-checkpoint-verifier-trust`).
- Subspec completion invokes mutation-checkpoint verification before accepting ticked criteria.
