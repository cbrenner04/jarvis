---
name: ready-gate-autofix-scopes-to-changed-files
---

# Ready-gate autofix scopes to changed files and surfaces diagnostics

Unsplit rationale: one execution-loop seam (`publishWithReadyRepair` ready-gate repair autofix); scoping, diagnostic surfacing, and out-of-diff settlement isolation are the same autofix invocation change.

## Primary implementation surface

- `v2/src/execution/write-loop.ts` (`publishWithReadyRepair` ready-gate repair autofix)

## Problem

Built-in ready-gate autofix runs repo-wide `bun run fix` (`bun biome check --write --unsafe .`). Pre-existing out-of-diff findings (e.g. `noNonNullAssertion`) can exceed biome's default `--max-diagnostics` cap, exit non-zero, and settle retryable `completion_commit_failed` even when the run's own diff is complete and correct. The cap also truncates the real blocking diagnostic in run logs.

## Decision ledger

- Scope built-in ready-gate autofix to the run's changed paths (`<baseRef>...HEAD` ∪ untracked), invoking scoped `biome check --write` (with `--unsafe` when matching default fix semantics) instead of repo-wide `bun run fix` / `check:fix:unsafe`; rules out continuing to autofix `.` and inheriting unrelated repo findings.
- Raise `--max-diagnostics` on ready-gate autofix biome subprocess invocations so a genuine in-scope failure names the blocking finding in `jarvis run log`; rules out default-cap truncation (`Diagnostics not shown: N`) hiding the operative error.
- Out-of-diff pre-existing findings must not cause autofix to settle `completion_commit_failed`; a run is responsible only for its own diff — same contract as `ready_gate_out_of_scope` on the test step; rules out treating unrelated repo lint noise as completion-commit failure.
- Deferred to first consumer: whether a configured `fixCommand` that expands to repo-wide biome should be rewritten to scoped paths or left as operator responsibility — pin when a caller needs it.

## Acceptance criteria

- [ ] Built-in ready-gate autofix scopes biome to the run's changed paths (`<baseRef>...HEAD` ∪ untracked), not repo-wide `.`; a `write-loop.test.ts` regression with a pre-existing out-of-diff lint finding fails against the pre-fix repo-wide autofix path.
- [ ] Pre-existing out-of-diff lint findings do not cause ready-gate autofix to settle `completion_commit_failed`; the same regression fails against the pre-fix path.
- [ ] A genuine in-scope autofix failure names the blocking finding in run log output (not only a truncation summary such as `Diagnostics not shown: N`); a `write-loop.test.ts` regression fails against the pre-fix default-cap path.
- [ ] A run whose changed files are clean succeeds through ready-gate autofix when out-of-diff `noNonNullAssertion` findings exist elsewhere; a `write-loop.test.ts` regression fails against the pre-fix path.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — ready-gate autofix section: scoped changed-file biome, raised diagnostic limit, out-of-diff findings do not strand completion commit.
- `v2/docs/write-behavior.md` — ready-gate repair autofix paragraph: built-in path scopes to changed paths; distinct from completion-commit scoped format.
- `v2/docs/v1-behaviors.md` — parity baseline for scoped ready-gate repair autofix.

## Prerequisites

- Ready-gate repair autofix runs once per `publishWithReadyRepair` repair entry after the repair fence allowset is frozen and before bounded agent repair.
- Repair fence allowset is derived from the committed `<baseRef>...HEAD` diff plus the resolved spec scope before autofix or repair runs.
- `ready_gate_out_of_scope` settles red ready-gate output naming failing paths outside the run's attributable allowset without entering bounded repair.
- Completion commit enumerates changed worktree paths from git status inventory for scoped `biome check --write` in `completion-commit.ts`.
