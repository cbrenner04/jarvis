# In-loop diff-derived mutation verification and reprompt

## Problem

Diff-derived mutation verification runs only at ready finalization after publication, so every uncovered changed guard strands the run and forces operator hand-finish once the agent has already claimed `done`.

## Decision ledger

- Run `verifyDiffDerivedMutations` on implement (`patch.prompt.body`) `complete` iterations only, after intent-split landing and plan-draft staged-Markdown lint gates when those apply, after coverage advisory, and before per-iteration checkpoint commit, completion commit, and `publishWithReadyRepair`; rules out first discovery at publication, verification after completion commit, or gating intent-split/plan-draft complete paths.
- Run in-loop verification for every implement `result.kind === "complete"` iteration, including `no-work`, and when `publishCompletion === false`; rules out skipping no-work or non-publishing runs while guard changes may exist in the worktree.
- In-loop verification is post-settlement harness work exempt from `iterationTimeoutMs` (same seam as coverage advisory and landing/staged-Markdown gates); bounded only by verifier `MAX_VERIFICATION_MS`; mid-verification deadline expiry uses the verifier's existing stop-scan behavior without a new terminal outcome.
- Reuse `verifyDiffDerivedMutations` unchanged at the new call site; rules out a second verifier implementation.
- Reprompt a surviving mutation through the existing in-loop landing/blocker reprompt path: durable `surviving_mutation_reprompt` log event, `WriteLoopInput` reprompt context, and `write.surviving-mutation-reprompt` prompt injection naming the mutation string, source file and line, and both remedies (add or extend a co-located killing test, or place an exact colocated `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` directive on the mutated physical line when behavior-neutral); rules out terminal `surviving_mutation_failed` on first in-loop discovery or a bespoke reprompt channel.
- Reprompt consumes the normal `maxIterations` budget and commits an `in-progress` / `progress` completion boundary before `continue`; rules out a separate repair budget or skipping progress boundary accounting.
- `write.surviving-mutation-reprompt` reuses `write.mutation-repair` placeholders (`SURVIVING_MUTATION`, `SOURCE_FILE`, `SOURCE_LINE`, `DUAL_CONSTRAINT_DETAIL`); rules out divergent placeholder names.
- `write-loop.test.ts` regressions reach in-loop verification through an optional `verifyDiffDerivedMutations` seam on `WriteLoopInput` (production omits it and calls the real verifier); rules out publication-finalizer mocks as the only proof of in-loop behavior.

## Prerequisites

- `verifyDiffDerivedMutations` accepts exact colocated `// @mutate-equivalent mutation=<JSON string> reason=<JSON string>` directives and reports `acceptedSites` without running killing tests for accepted candidates.
- Implement write loop already reprompts landing-contract and staged-Markdown lint misses through `landing_contract_reprompt` / `staged_markdown_lint_reprompt` with checkpoint-then-`continue` semantics.

## Task checklist

- In `write-loop.ts`, on `patch.prompt.body` `complete` only (including `no-work`), after existing landing/staged-Markdown gates and `runCoverageAdvisory`, call `verifyDiffDerivedMutations` with current bounds (`MAX_INSPECTED_MUTATIONS`, `MAX_VERIFICATION_MS`) using the run worktree and base ref; run before checkpoint commit even when `publishCompletion === false`.
- On `surviving-mutation`, checkpoint the settled iteration, then either reprompt (budget remaining) or settle terminal `surviving_mutation_failed` with the same resumable detail shape as today's publication path (budget exhausted).
- Wire surviving-mutation reprompt mirroring landing contract: `SurvivingMutationRepromptEvent` in `log-stream.ts`; `survivingMutationReprompt` on `WriteLoopInput` and `pendingSurvivingMutationReprompt` in `write-loop.ts`; pass-through in `buildWriteExecuteInput`, `awaitIteration`, and `resolveWriteLoopBindings`; `survivingMutationReprompt` on `WriteExecuteInput` and prompt injection in `write.ts`.
- Add `prompts/write/surviving-mutation-reprompt.md` (`write.surviving-mutation-reprompt`) and registry entry; inject from `write.ts` for `patch.prompt.body` when reprompt context is present.
- Update `KILLING_TEST_RULE` in `write-loop-input.ts` (`IMPLEMENT_WRITE_STEP_RULES`) so agents know killing tests are verified at implement `done`, not only at publication.
- Add optional `verifyDiffDerivedMutations` seam on `WriteLoopInput` for tests; production path calls the real verifier.
- Add `write-loop.test.ts` regression: surviving mutation at implement `done` triggers reprompt naming mutation and source site; a subsequent iteration that adds a killing test completes without a publication-time `surviving_mutation_failed` strand.

## Acceptance criteria

- [ ] `write-loop.test.ts` `implement complete surviving mutation reprompts before publication` drives `patch.prompt.body` to `done` with an uncovered changed guard via the in-loop `verifyDiffDerivedMutations` seam, asserts a `surviving_mutation_reprompt` durable log event (including `dualConstraint: true` when the survivor is dual-constraint) and loop re-entry naming the mutation and source file/line, then completes after a follow-up iteration adds a co-located killing test without settling `surviving_mutation_failed` at publication; fails against the pre-fix loop that only verifies at ready finalization.

## Documentation updates

- Deferred to subspec 04 (`IMPLEMENT_WRITE_STEP_RULES` lands here; operator docs in 04).
