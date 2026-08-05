---
name: mutation-checkpoint-verifier-trust
---

# Mutation checkpoints can pass without running, fire on prose, and outlive their run

The fix touches one module-boundary surface (execution loop), so splitting does not apply.

## Module-boundary surface

- Execution loop: mutation-checkpoint selection, resolution, scoped verification lifecycle, and completion-boundary stranded-mutation refusal.

## Problem

- **A — selection and linking fire on non-claims:** bare `@mutate` substring selection treats prose mentions as checkpoint claims; `linkDirectivesToCriterion` inherits every file directive when no pin title matches; `parseMutateDirectives` floods reports from string literals.
- **B — unresolvable directives pass the gate:** `unparseable` entries log to stderr and are ignored; basename-only pinning resolution fails on duplicated test basenames and ignores path-qualified references.
- **C — verification outlives its run:** scoped verification has no abort/timeout wiring; restoration is in-process only; `git add -A` can ship stranded mutations; pre-commit checks must read staged/committed content.

## Decisions

- Select on `Mutation checkpoint:` or a directive-shaped `@mutate` occurrence (`DIRECTIVE_PATTERN`), not bare `@mutate` prose — rules out prose mentions selecting a criterion without narrowing phrase-only selection.
- Drop the all-directives-in-file fallback in `linkDirectivesToCriterion` — rules out inherited claims.
- Restrict unparseable reporting to comment-leading `@mutate` lines — rules out string literals flooding the operator report.
- `unparseable`/unresolved entries fail the completion gate like `hollow`, naming criterion, raw reference, and reason — rules out silently-unverified ticked checkpoints; lands with or after the three fixes above.
- Resolve pinning-test references as repo-relative path first, basename search only when no path separator; ambiguous basename is a named failure — rules out guessing and rules out authors unable to disambiguate.
- Wire scoped verification to the run `AbortSignal` with a per-directive timeout of min(remaining write-iteration wall, `SUPPORTED_HEALTHY_FILE_BUDGET_MS` / 180s) — rules out verification outliving the loop that started it; no separate operator override.
- Restore from a snapshot taken before the first mutation on abort and on throw — rules out relying on the mutation loop reaching its own restore step.
- Before completion commit, refuse when replacement text is present and original absent, reading staged/committed content — rules out `git add -A` shipping stranded mutations and rules out working-copy-only comparison.
- Out of scope: directive syntax, phrase-only selection path, keystone directives (`plan-review-must-falsify-guard-premises`).

## Acceptance criteria

- [ ] A ticked criterion whose text names `@mutate` in prose, with no directive-shaped occurrence, is ignored — no hollow entry; a regression fails against the bare-substring selector.
- [ ] A ticked criterion quoting a full directive-shaped `@mutate` occurrence is still selected and still verified end to end.
- [ ] A criterion whose pin title resolves to no test in the linked file is reported unresolved and inherits no directives; a regression covers the previous all-directives fallback.
- [ ] Running the verifier over a subspec whose prose discusses `@mutate` (use `v2/spec/completed/20260802T045701Z-verify-directive-only-mutation-criteria/00-…md` or an equivalent fixture) reports zero hollow entries.
- [ ] String literals containing `@mutate` in a pinning test file produce no unparseable entries.
- [ ] A ticked mutation-checkpoint criterion whose pinning-test reference resolves to no file, or to more than one basename match, blocks completion with a named blocker carrying the criterion text, raw reference, and reason; a regression fails against the current stderr-only path.
- [ ] A criterion referencing a path-qualified pinning test (`v2/src/execution/write.test.ts`) resolves to that exact file and verifies end to end, even when its basename is duplicated elsewhere in the repo.
- [ ] A bare-basename reference with exactly one repo match keeps resolving as it does today.
- [ ] Running the verifier over the merged `20260802T035103Z-execution-loop-human-only-contracts` subspec (or an equivalent fixture with a `write.test.ts` reference) reports zero unparseable entries and two caught directives.
- [ ] Aborting a run mid-verification stops the scoped run and restores every mutated file; a test aborts during verification and asserts the file matches its pre-mutation bytes.
- [ ] A scoped verification run that exceeds its own timeout is terminated and its file restored, rather than blocking the step indefinitely.
- [ ] A verification that throws mid-directive restores the file; a regression covers the throw path distinctly from the abort path.
- [ ] The completion boundary refuses when a target file contains a directive's replacement text while missing its original, naming path and directive; a regression fails against the current committer. The check reads staged/committed content: a second regression covers a mutation present in `HEAD` but absent from the working copy.
- [ ] Mutation checkpoints: a `// @mutate` directive reverting selection to the bare-substring test, a second removing the unparseable-fails-the-gate branch, and a third removing the pre-commit stranded-mutation check each turn their pinning test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — phrase marker unchanged; bare `@mutate` prose no longer selects; directive-shaped `@mutate` still selects; unparseable now blocks; scoped verification abort/timeout; replace `SIGKILL`-only stranded-mutation caveat (any abnormal settle can strand one; completion boundary now refuses it).
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — phrase or directive-shaped `@mutate` selection unchanged; reference pinning test by repo-relative path when basename is not unique; bare `@mutate` prose mentions are safe.
- `v2/docs/v1-behaviors.md` — amend the implement-write mutation-checkpoint bullet: selection narrows to phrase or directive-shaped `@mutate` (not bare prose); unparseable/unresolved block; path-qualified pinning; scoped verification abort/timeout and stranded-mutation refusal at completion boundary.

## Prerequisites

- The execution-loop verifier selects ticked non-human criteria, parses `// @mutate` directives from pinning tests, applies them to production source, runs classified scoped suites, refuses surviving mutations, and restores source in-process.
- The write-loop completion boundary stages the worktree with `git add -A` before committing.
