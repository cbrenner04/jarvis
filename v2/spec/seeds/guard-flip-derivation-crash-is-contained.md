---
name: guard-flip-derivation-crash-is-contained
---

# A mis-derived guard-flip candidate crashes the whole run non-resumably

## Problem

Guard-flip mutation-candidate derivation (`deriveFromLine` / guard family in `v2/src/execution/diff-derived-mutation-verifier.ts`) mis-slices a negated method call. On `if (!CONSUMER_FILES.has(file) || …)` it derives the mutation `guard-flip: !CONSUMER_FILES → CONSUMER_FILES` — treating `!CONSUMER_FILES` as the negated unit instead of `!CONSUMER_FILES.has(file)`. When `testCandidate` applies it, `applyMutation`'s slice-verify (`line.slice(columnStart, columnEnd) !== originalText`) throws because the derived span/text does not match the source, `testCandidate` rethrows `Failed to test candidate for <file>:<line>`, and the write loop settles `run_execution_failed` — **`invocation_error`, `retryable: false`, `nextAction: stop`**. A single `!obj.method(…)` guard on a changed line thus crashes an otherwise-complete implement non-resumably.

Two defects compound: (1) guard-flip derivation is still regex-based and mis-parses `!<expr>.<call>` (the scanner migration in `derive-mutation-candidates-from-typescript-scanner` / #3202 covered only operator-flip); (2) an unappliable candidate is a fatal, non-resumable run crash rather than a contained skip.

## Evidence (2026-08-30)

Run `da6ec4b9` (implement `cleanup-uses-lossless-git-status`): `run_execution_failed: Failed to test candidate for scripts/guard-lossless-git-status-inventory.ts:57`, candidate `guard-flip: !CONSUMER_FILES → CONSUMER_FILES`. The actual guard is `!CONSUMER_FILES.has(file)` and is well covered — flipping it fails 11 co-located tests in `scripts/guard-lossless-git-status-inventory.test.ts`. All subspec ACs were ticked (code complete); only the verifier crashed. Salvaged by hand-publish.

## Decisions

- **Contain first (fail-soft):** an unappliable candidate (slice-verify mismatch, or any `applyMutation`/`testCandidate` throw) must be skipped or reported as a derivation diagnostic, never propagated as `run_execution_failed`. A verifier that cannot test one candidate must not forfeit a complete, covered run non-resumably. Rules out the current fatal rethrow.
- **Fix at the root:** guard-flip derivation slices `!<expr>` including member/call chains (`!obj.method(args)`), or migrates to the same TypeScript-scanner classification #3202 used for operator-flip. Rules out extending the regex.
- Scope: guard-flip (and destructive) derivation and the `testCandidate` failure path; no change to operator-flip (already scanner-based) or the killing-test/render-coverage resolution.

## Acceptance criteria

- [ ] A `diff-derived-mutation-verifier.test.ts` regression drives a changed line `if (!obj.has(x) || y)` and proves `verifyDiffDerivedMutations` returns a normal result (no thrown error, no `run_execution_failed`) — either no malformed `!obj → obj` candidate is derived, or the unappliable candidate is skipped; it fails against the pre-fix fatal rethrow.
- [ ] A regression proves a guard-flip candidate on `!obj.method(args)` targets the correct span (the negated boolean sub-expression), with `originalText` that `applyMutation` can slice-verify; it fails against the pre-fix `!obj` mis-slice.
- [ ] A regression proves `testCandidate` slice-verify mismatch is contained (skipped/reported), not surfaced as a terminal non-resumable run failure.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Gate trust / mutation verification: note that a `run_execution_failed` `Failed to test candidate` is a verifier-derivation crash (currently non-resumable); salvage the complete worktree by hand.
