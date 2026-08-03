---
name: unparseable-mutation-directives-pass-the-gate
---

# An unresolvable pinning-test reference makes a mutation checkpoint pass without ever running

## Problem

`verifyMutationCheckpoints` fails the completion gate on `hollow` entries only. An `unparseable`
entry — a selected criterion whose directive could not be resolved — is written to stderr and
otherwise ignored, so the criterion ticks green having never had its mutation applied. The operator
sees a green gate and a checkpointed criterion, and has no signal that the checkpoint did nothing.

The resolver reaches `unparseable` more easily than it looks. `pinningTestBasenameFromCriterion`
(`mutation-checkpoint-verifier.ts:187-196`) reduces the criterion's backticked test reference to a
bare **basename**, and `resolveLinkedDirectives` (`:333-338`) requires `findByBasename` to return
exactly one match. A path-qualified reference does not help — the resolver basenames whatever it is
given — so any duplicated test-file basename in the repo is unresolvable by construction.

Observed on PR #2541 (merged 2026-08-03). Its subspec carried two directives; running the shipped
verifier over it reports:

```text
caught:      1   (implement-workflow-steps.test.ts)
unparseable: 1   reason: "unresolved_pinning_test"
                 raw:    "`write.test.ts` — Mutation checkpoint: ..."
```

`v2/src/execution/write.test.ts` and `v2/src/commands/write.test.ts` both exist, so the basename is
ambiguous. The directive itself was correct — applied by hand it turns the named test RED — but the
harness never applied it. The criterion reached `main` ticked and unproven, which is the same
failure class as the #2518 gap the queue already records.

## Decisions

- `unparseable` entries fail the completion gate the same way `hollow` does — rules out a
  silently-unverified ticked checkpoint. The blocker names the criterion, the raw reference, and the
  reason.
- Resolve a criterion's pinning-test reference as a **repo-relative path first**, falling back to
  basename search only when the reference has no path separator — rules out spec authors being
  unable to disambiguate a duplicated basename.
- An ambiguous basename with no path separator stays a named failure, not a silent pass — rules out
  guessing among candidates.
- Out of scope: directive syntax, selection (`mutation-selector-fires-on-prose-mentions-of-the-marker`
  owns that), and the scoped-run lifecycle.

## Acceptance criteria

- [ ] A ticked mutation-checkpoint criterion whose pinning-test reference resolves to no file, or to
      more than one basename match, blocks completion with a named blocker carrying the criterion
      text, raw reference, and reason; a regression fails against the current stderr-only path.
- [ ] A criterion referencing a path-qualified pinning test (`v2/src/execution/write.test.ts`)
      resolves to that exact file and verifies end to end, even when its basename is duplicated
      elsewhere in the repo.
- [ ] A bare-basename reference with exactly one repo match keeps resolving as it does today.
- [ ] Running the verifier over the merged `20260802T035103Z-execution-loop-human-only-contracts`
      subspec (or an equivalent fixture with a `write.test.ts` reference) reports zero unparseable
      entries and two caught directives.
- [ ] Mutation checkpoint: a `// @mutate` directive in the pinning test file that removes the
      unparseable-fails-the-gate branch turns the blocker regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — correct the claim that an unparseable directive is
  "reported and skipped rather than treated as hollow"; it now blocks.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — reference the pinning test by
  repo-relative path when its basename is not unique.

## Prerequisites

- `verifyMutationCheckpoints`, `pinningTestBasenameFromCriterion`, `resolveLinkedDirectives`,
  `findByBasename` (`v2/src/execution/mutation-checkpoint-verifier.ts`)
