# 00 - Scoped ready-gate repair autofix biome

## Primary implementation surface

`v2/src/execution/write-loop.ts` (`publishWithReadyRepair` ready-gate repair autofix)

## Problem

Built-in ready-gate repair autofix invokes `runFixCommand`, which resolves to repo-wide `bun run fix` (`bun biome check --write --unsafe .`). Pre-existing out-of-diff findings (for example `noNonNullAssertion` in files the run never touched) can exceed biome's default `--max-diagnostics` cap, exit non-zero, and settle retryable `completion_commit_failed` even when the run's own diff is complete. The cap also truncates the blocking diagnostic behind `Diagnostics not shown: N` in autofix failure output surfaced through `jarvis run log`.

Reachable on main today: `publishWithReadyRepair` calls `(args.runFixCommand ?? runFixCommand)(fixOpts)` before typecheck verification (`write-loop.ts` ~3290–3307); `shared/fix-command.ts` spawns the configured or default package-manager script without path scoping.

## Decision ledger

- Scoped built-in biome runs only when `fixCommand` is unset **and** `args.runFixCommand` is not injected; injected `runFixCommand` and configured `fixCommand` continue through `(args.runFixCommand ?? runFixCommand)` unchanged; rules out new built-in regressions passing via the `runFixCommand` test seam while production repo-wide autofix regresses.
- Built-in ready-gate repair autofix (no configured `fixCommand`, no injected `runFixCommand`) invokes scoped `bun biome check --write --unsafe` on the run's changed paths only (`<baseRef>...HEAD` three-dot diff ∪ untracked inventory), not repo-wide `bun run fix` / `check:fix:unsafe .`; rules out continuing to autofix `.` and inheriting unrelated repo findings.
- Changed-path enumeration for autofix uses the same diff and untracked git seams as `deriveGateAllowedPaths` (`git diff --name-status -z` on `${baseRef}...HEAD` plus `git ls-files --others --exclude-standard -z`), unioned and normalized, without adding spec-tree paths the diff did not touch; rules out reusing the full fence allowset (spec tree ∪ diff) as biome argv or inventing a third enumeration scheme.
- Enumerated paths pass through `excludeExternalSpecGitPaths` with the same `ExternalSpecGitScope` inputs as completion-commit before biome-eligible filtering; rules out autofix scoping to external-plan spec copies that completion-commit excludes from format argv.
- `${baseRef}...HEAD` or untracked enumeration parse/unavailable failure fails closed into autofix failure / `completion_commit_failed` (same contract as `deriveGateAllowedPaths` returning `undefined`); rules out silently skipping autofix or falling back to repo-wide `.` on git seam failure.
- Biome-eligible path filtering matches completion-commit (`biomeEligiblePaths` / extension set in `completion-commit.ts`); empty eligible set skips the subprocess without error; rules out `No files were processed` failing autofix on markdown-only or deletion-only changed sets.
- Autofix biome subprocess argv includes `--max-diagnostics=256` (fixed constant at the call site); rules out default-cap truncation hiding the operative in-scope finding.
- Out-of-diff pre-existing findings must not cause built-in autofix to settle `completion_commit_failed`; only genuine in-scope biome failure (non-zero exit on scoped paths, timeout, missing biome when eligible paths exist, or enumeration failure above) fails closed into `completion_commit_failed`; rules out treating unrelated repo lint noise as completion-commit failure.
- Deferred to first consumer: whether a configured `fixCommand` that expands to repo-wide biome should be rewritten to scoped paths or left as operator responsibility — pin when a caller needs it; built-in path changes here only.
- Configured `fixCommand` continues through `runFixCommand` unchanged; rules out breaking custom autofix wiring in the same seam.

## Prerequisites

- Ready-gate repair autofix runs once per `publishWithReadyRepair` repair entry after the repair fence allowset is frozen and before bounded agent repair (`write-loop.ts` ~3277–3366).
- Repair fence allowset is derived from committed `<baseRef>...HEAD` diff plus resolved spec scope before autofix or repair (`initializeFrozenRepairAllowset`).
- `ready_gate_out_of_scope` settles red ready-gate output naming failing paths outside the attributable allowset without entering bounded repair (`ready-finalize.ts`, `write-loop.test.ts` untouched-path settlement cases).
- Completion commit enumerates changed worktree paths from git status inventory for scoped `biome check --write` (`completion-commit.ts`).

## Work

- Add or reuse a helper to enumerate changed paths for autofix (`<baseRef>...HEAD` ∪ untracked, `excludeExternalSpecGitPaths`, biome-eligible filter); prefer exporting or sharing `biomeEligiblePaths` from `completion-commit.ts` rather than duplicating extension logic.
- Replace the built-in `runFixCommand` call in `publishWithReadyRepair` with scoped biome autofix when `args.fixCommand` is unset **and** `args.runFixCommand` is not injected; keep `(args.runFixCommand ?? runFixCommand)` for configured `fixCommand` or injected `runFixCommand`.
- Pass raised `--max-diagnostics` on the autofix biome subprocess; surface subprocess output in `FixCommandError`-shaped failures for log tails.
- Add `runBuiltInReadyGateAutofixBiome` test seam on `WriteLoopInput` (parallel to `runFixCommand` / `runAutofixTypecheck`); production default delegates to the real scoped biome subprocess; argv AC records invocations through this seam.
- Add built-in-path regressions under the existing `ready-gate repair autofix` describe in `write-loop.test.ts` using this fixture contract: real-git worktree (same precedent as `labels ready-gate repair commits`), omit `runFixCommand` and `completionHooks.runFixCommand`, stub `runAutofixTypecheck` when post-autofix typecheck would mask biome fixture behavior; add `// @mutate` mutation checkpoint on the scoped-invocation guard.
- Preserve existing configured-`fixCommand` and formatter-only autofix regressions.

## Acceptance criteria

- [x] `write-loop.test.ts` test `ready-gate repair autofix ignores pre-existing out-of-diff lint findings` (built-in fixture contract: real-git worktree, no `runFixCommand` / `completionHooks.runFixCommand`, `runAutofixTypecheck` stubbed when needed) seeds a pre-existing out-of-diff `noNonNullAssertion` (or equivalent non-autofixable lint) outside the run diff, drives a red gate whose only fix is in changed paths, asserts built-in autofix does not invoke biome on `.`, publication succeeds without `completion_commit_failed`, and the out-of-diff file is untouched; fails against the pre-fix repo-wide `runFixCommand` path.
- [x] `write-loop.test.ts` test `ready-gate repair autofix surfaces in-scope blocking diagnostic in failure output` (built-in fixture contract) drives built-in autofix against a changed path with a non-autofixable in-scope lint finding, asserts `completion_commit_failed` failure output names the blocking rule (for example `noNonNullAssertion`); truncation / raised `--max-diagnostics` guarded by the argv AC below.
- [x] `write-loop.test.ts` test `ready-gate repair autofix scopes biome argv to changed paths` (built-in fixture contract; argv captured via `runBuiltInReadyGateAutofixBiome` seam) asserts the built-in autofix subprocess argv lists only changed biome-eligible paths and includes `--unsafe` and `--max-diagnostics=256`; sole falsifiable AC for raised diagnostic cap / anti-truncation intent; fails against the pre-fix repo-wide autofix path.
- [x] `write-loop.test.ts` test `ready-gate repair autofix invokes configured fixCommand` stays green (configured `fixCommand` still uses `runFixCommand`; scoping deferred).
- [x] `write-loop.test.ts` test `ready-gate repair autofix greens a formatter-only red gate without repair iterations` stays green.
- [x] Mutation checkpoint: `write-loop.test.ts` links `// @mutate` inverting the scoped built-in autofix guard; inverting turns `ready-gate repair autofix ignores pre-existing out-of-diff lint findings` red.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- Deferred to subspec 01 (durable operator and parity docs for the same behavior).
