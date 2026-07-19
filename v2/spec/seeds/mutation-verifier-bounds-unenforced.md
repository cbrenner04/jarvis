---
name: mutation-verifier-bounds-unenforced
---

# Mutation verifier's count/time bounds are unenforced

## Problem

`v2/src/execution/diff-derived-mutation-verifier.ts` (merged in #1787) has no
mutation-count or wall-clock bound, despite the spec's own acceptance
criterion: "Applied-mutation count and total verification wall-clock are
bounded; hitting a bound ends verification without inspecting remaining or
unchanged files" — ticked `[x]` in the merged PR without being implemented.
`verifyDiffDerivedMutations` iterates every derived candidate with no cap and
no deadline.

Discovered 2026-07-19: a stray, unmergeable duplicate run of the same spec
(orphaned by a daemon restart mid-repair, later closed as PR #1788 — its
branch had diverged from `main`'s squash-merge history) independently added
real `MAX_APPLIED_MUTATIONS`/`MAX_VERIFICATION_MS` constants during its own
gate-repair loop, confirming the gap is real and fixable, but that PR itself
hit a genuine self-detected `surviving-mutation` failure in its added code and
was closed rather than merged. Nothing from it landed.

## Decisions

- Cap applied-mutation count and total wall-clock inside
  `verifyDiffDerivedMutations`; rules out an unbounded loop over every derived
  candidate on a large diff.
- Hitting either bound ends verification as a passing result recording how
  many candidates were actually inspected (not the full derived count); rules
  out treating a bound-stop as a failure or as silently equivalent to a
  clean pass with the pre-bound `candidateCount`.
- Do not reuse PR #1788's specific implementation verbatim; rules out carrying
  forward code that already failed its own mutation check unexamined.

## Acceptance criteria

- [ ] Applied-mutation count is capped; exceeding the cap stops verification
      without inspecting further candidates.
- [ ] Total verification wall-clock is capped; exceeding it stops verification
      without inspecting remaining candidates.
- [ ] A bound-stop returns a `pass` result whose `candidateCount` (or an added
      field) reflects candidates actually inspected, not the full derived set.
- [ ] A new test drives each bound (count and time, via an injected clock/seam)
      to a bound-stop and fails against the pre-fix unbounded loop.
- [ ] `bun run typecheck`, `bun run test:v2`, and the verifier's test file pass.

## Documentation updates

- `v2/docs/write-behavior.md` — record the enforced bounds (currently
  documents them as "future enhancement").
