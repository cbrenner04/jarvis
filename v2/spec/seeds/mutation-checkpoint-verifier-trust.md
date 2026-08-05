---
name: mutation-checkpoint-verifier-trust
---

# Mutation checkpoints can pass without running, fire on prose, and outlive their run

One bundle: all three defects live in `v2/src/execution/mutation-checkpoint-verifier.ts`, and they
interlock — making unparseable entries fail the gate (B) without first fixing selection and
reporting (A) turns today's known false positives into gate failures on the verifier's own specs.
Absorbs `unparseable-mutation-directives-pass-the-gate`,
`mutation-selector-fires-on-prose-mentions-of-the-marker`, and
`mutation-verification-outlives-its-run` (2026-08-04); the last had already absorbed
`mutation-verification-artifact-reached-the-completion-commit`.

Land this bundle **first** among the open seeds: every other seed's `@mutate` acceptance criteria
run through the verifier it fixes, and until B lands a dud pin ticks green silently (#2591, #2597).

## Problem A — selection and linking fire on non-claims

PR #2518 broadened selection to `CRITERION_MARKER || DIRECTIVE_MARKER`, where `DIRECTIVE_MARKER` is
the bare substring `@mutate`. Selection is a substring test, so a criterion that merely *names* the
marker in prose is treated as a checkpoint claim and refused as hollow for having no directive.
Demonstrated on #2518's own spec (`20260802T045701Z-verify-directive-only-mutation-criteria/00-…md`):
`hollow: 2, caught: 0`, both entries meta criteria describing the contract. Two amplifiers:

- `linkDirectivesToCriterion` falls back to **every** directive in the file when no pin title
  matches, so a criterion that merely names a test file inherits directives it never claimed.
- `parseMutateDirectives` treats any line containing `@mutate` as a directive candidate; the
  verifier's own test file produced **52** unparseable entries, drowning the operator report.

## Problem B — an unresolvable directive passes the gate

`verifyMutationCheckpoints` fails the completion gate on `hollow` entries only. An `unparseable`
entry — a selected criterion whose directive could not be resolved — is written to stderr and
otherwise ignored, so the criterion ticks green having never had its mutation applied.

The resolver reaches `unparseable` easily: `pinningTestBasenameFromCriterion`
(`mutation-checkpoint-verifier.ts:187-196`) reduces the criterion's backticked test reference to a
bare **basename**, and `resolveLinkedDirectives` (`:333-338`) requires `findByBasename` to return
exactly one match — a path-qualified reference does not help, so any duplicated test-file basename
is unresolvable by construction. Observed on PR #2541 (`write.test.ts` exists in both
`v2/src/execution/` and `v2/src/commands/`): the directive was correct — applied by hand it turns
the named test RED — but the harness never applied it, and the criterion reached `main` ticked and
unproven. Recurred on #2591 and #2597 (dud pins ticked green), plus a 40% cost over-bill earlier.

## Problem C — verification outlives its run and strands mutations

An ordinary `iteration_timeout` — not just `SIGKILL` — strands applied `@mutate` directives in
production source, and the scoped verification keeps applying and restoring directives **after the
run row is terminal**. Observed 2026-08-02, run `ee3b2cb9` (`20260802T075146Z-tui-dock-projection`):
three stranded directives (`if (false)`, `false ||`, `const killable = false`), with restores racing
the operator's salvage so no single read of a file could be trusted. Recurred 2026-08-03 on
`20260803T013930Z-tui-command-dispatch`: a stranded `if (false)` was copied into a salvage branch
and caught only by a pre-commit diff (PR #2575).

Two defects: the scoped verification run has no timeout and is not wired to the run's abort signal;
and restoration is in-process only, so when the loop settles out from under it the mutated file
stays and `git add -A` in any later commit ships it — a silent behavior change that typechecks.
PR #2314 shipped a mutation present in `HEAD` while the working copy read correct, so any
pre-commit check must read the content being committed, not the working tree.

## Decisions

- Select on a directive-**shaped** occurrence — `@mutate` followed by a path and the quoted
  `"<old>" -> "<new>"` form (the existing `DIRECTIVE_PATTERN`) — not a bare substring — rules out
  prose mentions selecting a criterion, without narrowing back to the phrase-only selector #2518
  fixed.
- Drop the all-directives-in-file fallback in `linkDirectivesToCriterion`: a criterion with no
  resolvable pin is reported unresolved, not silently assigned every directive in the file — rules
  out inherited claims.
- Restrict unparseable reporting to lines that look like a directive attempt (comment-leading
  `@mutate`) — rules out string literals flooding a report the operator learns to ignore.
- `unparseable`/unresolved entries fail the completion gate the same way `hollow` does; the blocker
  names the criterion, the raw reference, and the reason — rules out a silently-unverified ticked
  checkpoint. **Ordering: lands with or after the three fixes above**, or today's false positives
  become gate failures.
- Resolve a pinning-test reference as a **repo-relative path first**, falling back to basename
  search only when the reference has no path separator; an ambiguous basename stays a named
  failure — rules out authors being unable to disambiguate, and rules out guessing.
- Wire the scoped verification run to the run's `AbortSignal` and give it its own timeout — rules
  out verification that outlives the loop that started it.
- Restore from a snapshot taken **before** the first mutation, in a path that runs on abort and on
  throw — rules out relying on the mutation loop reaching its own restore step.
- Before any completion commit, refuse when a directive's replacement text is present in a target
  file where its original is absent, checking staged/committed content rather than the working
  copy — rules out `git add -A` shipping a stranded mutation, and rules out the working-copy-only
  comparison that passed on PR #2314.
- Out of scope: directive syntax, the phrase selection path, and keystone directives
  (`plan-review-must-falsify-guard-premises`, which extends this machinery and lands after this
  bundle).

## Acceptance criteria

- [ ] A ticked criterion whose text names `@mutate` in prose, with no directive-shaped occurrence,
      is ignored — no hollow entry; a regression fails against the bare-substring selector.
- [ ] A ticked criterion quoting a full directive-shaped `@mutate` occurrence is still selected and
      still verified end to end.
- [ ] A criterion whose pin title resolves to no test in the linked file is reported unresolved and
      inherits no directives; a regression covers the previous all-directives fallback.
- [ ] Running the verifier over a subspec whose prose discusses `@mutate` (use
      `v2/spec/completed/20260802T045701Z-verify-directive-only-mutation-criteria/00-…md` or an
      equivalent fixture) reports zero hollow entries.
- [ ] String literals containing `@mutate` in a pinning test file produce no unparseable entries.
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
- [ ] Aborting a run mid-verification stops the scoped run and restores every mutated file; a test
      aborts during verification and asserts the file matches its pre-mutation bytes.
- [ ] A scoped verification run that exceeds its own timeout is terminated and its file restored,
      rather than blocking the step indefinitely.
- [ ] A verification that throws mid-directive restores the file; a regression covers the throw
      path distinctly from the abort path.
- [ ] The completion boundary refuses when a target file contains a directive's replacement text
      while missing its original, naming path and directive; a regression fails against the current
      committer. The check reads staged/committed content: a second regression covers a mutation
      present in `HEAD` but absent from the working copy.
- [ ] Mutation checkpoints: a `// @mutate` directive reverting selection to the bare-substring
      test, a second removing the unparseable-fails-the-gate branch, and a third removing the
      pre-commit stranded-mutation check each turn their pinning test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — selection requires a directive-shaped occurrence;
  correct the claim that an unparseable directive is "reported and skipped rather than treated as
  hollow" (it now blocks); replace the `SIGKILL`-only stranded-mutation caveat (any abnormal settle
  can strand one, and the completion boundary now refuses it).
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — reference the pinning test by
  repo-relative path when its basename is not unique; prose mentions of the marker are safe.

## Prerequisites

- `verifyMutationCheckpoints`, `DIRECTIVE_MARKER`, `DIRECTIVE_PATTERN`, `parseMutateDirectives`,
  `linkDirectivesToCriterion`, `pinningTestBasenameFromCriterion`, `resolveLinkedDirectives`,
  `findByBasename`, and the scoped-run/restore path
  (`v2/src/execution/mutation-checkpoint-verifier.ts`)
- The write-loop completion committer (`git add -A` boundary)
