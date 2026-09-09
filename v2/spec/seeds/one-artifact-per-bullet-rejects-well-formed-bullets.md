---
name: one-artifact-per-bullet-rejects-well-formed-bullets
---

# The one-artifact-per-bullet rule blocks drafts whose bullets legitimately name two files

## Problem

The plan contract rejects any `## Acceptance criteria` or `## Decisions` bullet that references more than one artifact path. The rule exists to keep subspecs atomic — one bullet, one thing to build — and for a bullet that *creates* artifacts that is right.

It is applied to two bullet kinds where naming two paths is the correct, informative thing to do:

1. **A stays-green regression bullet.** "`X.test.ts` and `Y.test.ts` projections stay green (shape unchanged by this change)" asserts that two existing files keep passing. It creates nothing, so it is not a second unit of work; splitting it into two bullets asserts two obligations where there is one.
2. **A decision that genuinely spans two call sites.** "The sidecar directory is created at verdict-write time in the review executors (`review-cycle.ts`, `review-debate.ts`), not in the builder" is one decision about where a behavior lives. Splitting it claims two decisions that do not exist; dropping the paths loses the information the reader needs.

Both settle `contract_miss`, which is non-resumable (`nextAction: inspect_spec`), so a complete and otherwise-sound draft costs a hand-landing.

## Evidence (2026-09-09, two occurrences in one session)

- Run `b43f46d5`, `distinguish-configured-and-default-missing-gates`: blocked on an acceptance bullet naming `pipeline-execution.test.ts` and `run.test.ts`, both pre-existing files the change must not disturb. Hand-landed [#3680](https://github.com/cbrenner04/jarvis/pull/3680) after splitting the bullet in two.
- Run `06d7f3d4`, `implement-review-verdict-resolves-outside-the-spec-tree`: blocked on the Decisions bullet quoted above. Hand-landed [#3700](https://github.com/cbrenner04/jarvis/pull/3700) after rewording it to name the executors generically.

Both drafts were otherwise complete and correct, and both edits made the spec slightly worse to read.

## Class

Fourth instance of the brief's P1 class — plan-contract checks are strict lexical patterns over authored prose that fail **closed** on well-formed variation, and each fires late enough that a false positive costs a finished draft. Siblings: [[plan-contract-classifies-the-rules-out-clause]] (surface classifier reads the mandated `rules out` clause as a second surface), [[index-link-check-rejects-annotated-subspec-lines]] (`INDEX_LINK_PATTERN` anchors `$` at the closing paren, so an annotated link reads as absent — hit again this session on run `3852c294`), and #3383's bare-word over-match. Each was fixed as a point fix, which is why there is a fourth.

## Decisions

- The artifact-count rule applies only to bullets that assert an artifact is **created or changed**; a bullet asserting existing artifacts stay unchanged is exempt; rules out counting path mentions without reading what the bullet claims about them.
- A `## Decisions` bullet may name every call site the decision governs; the atomicity the rule protects is one decision per bullet, not one file per bullet; rules out forcing an author to split one decision into several or to drop the paths.
- The refusal message distinguishes *this bullet builds two things* from *this bullet mentions two paths*, and names which reading it applied; rules out a message that leaves the author guessing which edit will satisfy it.

## Acceptance criteria

- [ ] A test proves an acceptance bullet asserting two named existing test files stay green passes the contract; it fails against the current unconditional path count.
- [ ] A test proves a `## Decisions` bullet naming two call sites governed by one decision passes the contract; it fails against the current rule.
- [ ] A test proves a bullet that genuinely requires two new artifacts is still rejected, with a message naming both.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/spec-guidance.md` — state what the one-artifact rule counts and what it exempts, with an example of each.
