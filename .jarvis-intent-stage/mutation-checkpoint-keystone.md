---
name: mutation-checkpoint-keystone
---

# Implement completion refuses inert headline changes via keystone mutation checkpoints

A guard against an unreachable condition cannot be killed by mutation; a headline behavior change that does nothing cannot be caught by guard pins alone. This intent adds a keystone `// @mutate` directive that reverts the subspec's core change to baseline semantics; a surviving keystone means the shipped change is inert.

## Decisions

- Every runtime-behavior subspec whose headline change is not docs-only carries one keystone `// @mutate` directive reverting that headline to baseline semantics, distinct from guard pins — rules out shipping a no-op that passes its own guard tests.
- Keystone verification reuses `verifyMutationCheckpoints` apply/run/restore machinery unchanged — rules out a parallel verifier; selection/resolution policy for keystones is in scope here because verifier-trust explicitly deferred keystones.
- A keystone directive whose scoped suite stays green after apply is refused at completion with a named blocker distinct from hollow guard checkpoint blockers — rules out operators treating inert change as a proof-form guard problem.
- A keystone that turns its named test red completes normally; a subspec with guard checkpoints but no keystone is refused rather than silently passing — rules out guard-only coverage of headline changes.
- Full-diff revert is not the mechanism: new tests import new exports, so reverting everything yields compile errors rather than red tests — rules out whole-subspec revert as the keystone shape.
- Out of scope: intent-split prompt; phrase-only mutation-checkpoint selection path.

## Acceptance criteria

- [ ] A subspec whose headline change carries a keystone directive that survives its mutation is refused at completion with a named blocker distinguishing it from a hollow guard checkpoint; a regression fails against the pre-fix completion boundary.
- [ ] A keystone directive that turns its named test red completes normally, and a subspec with guard checkpoints but no keystone is refused rather than silently passing.
- [ ] Mutation checkpoint: a `// @mutate` directive removing the keystone-survival refusal turns its regression RED; pin via a unique-basename test naming the enclosing test title.
- [ ] `bun run typecheck`, `bun run check`, and `bun run test:v2` exit zero.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — keystone checkpoints alongside guard checkpoints for headline behavior changes.
- `v2/docs/operator-runbook.md` § Gate trust — a surviving keystone means an inert headline change; distinguish from hollow guard checkpoints and from premise-smell hollow (second hollow on a different guard).

## Prerequisites

- Plan debate review flags invariant criteria whose violation is unreachable on the repository base as unfalsifiable during debate review.
- Plan debate review reports dropped unfalsifiable premises that would empty a subspec rather than inventing filler scope.
- `REVIEW_PASS_CONTEXT` composes premise findings with at-risk hollow pins non-destructively.
- `verifyMutationCheckpoints` selects ticked non-human criteria, parses `// @mutate` directives from pinning tests, applies mutations, runs classified scoped suites, refuses surviving guard mutations as hollow, and restores source in-process (`mutation-checkpoint-verifier-trust`).
- Subspec completion invokes mutation-checkpoint verification before accepting ticked criteria.
