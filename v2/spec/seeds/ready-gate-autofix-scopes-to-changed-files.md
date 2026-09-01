---
name: ready-gate-autofix-scopes-to-changed-files
---

# Ready-gate autofix runs biome repo-wide and strands complete runs on the diagnostic limit

## Problem

The ready-gate autofix step runs the built-in `bun run fix` (= `check:fix:unsafe` = `bun biome check --write --unsafe .`) over the **whole repo**. On a repo that carries pre-existing `noNonNullAssertion`/other findings in files the run never touched, biome exceeds its default `--max-diagnostics` limit and exits non-zero while applying fixes ("The number of diagnostics exceeds the limit allowed"). The autofix then settles the run `completion_commit_failed` (retryable) even though the run's own work is complete and correct — the failure is entirely pre-existing findings elsewhere plus the diagnostic cap, not the run's diff.

Compounding: biome's default diagnostic cap also *hides* the actual blocking error behind the noise ("Diagnostics not shown: N"), so the operator can't see which finding failed without re-running with `--max-diagnostics` raised.

## Evidence

`route-external-implement-spec-trees` (2026-09-01) stranded here twice: complete 6-subspec work, `completion_commit_failed` naming `bun run fix failed: ... noNonNullAssertion` in `v2/src/commands/workflow.test.ts` / `daemon-pipeline-dismiss.test.ts` — files route never touched. Hand-salvaged by running biome scoped to the run's own changed files instead. The scoped fix is exactly what the autofix should do.

## Decisions

- Ready-gate autofix scopes biome `--write` to the run's changed files (base-to-HEAD diff ∪ untracked), not `.` — mirrors how the scoped completion/checkpoint commits already enumerate changed paths (`biome check --write <paths>`).
- Raise or remove `--max-diagnostics` on the gate's biome invocations so a genuine failure surfaces in the run log instead of being truncated.
- Out-of-scope pre-existing findings must not settle `completion_commit_failed`; a run is only responsible for its own diff (aligns with the existing `ready_gate_out_of_scope` contract on the test step).

## Acceptance criteria

- [ ] Ready-gate autofix that would fix/flag only files outside the run's changed set does not run biome over `.` and does not settle `completion_commit_failed` for those files — pinned by a test with a pre-existing out-of-diff finding.
- [ ] Autofix biome invocation raises `--max-diagnostics` (or sets it high enough) so the failing diagnostic is present in `jarvis run log`, not truncated — pinned by a test asserting the surfaced message names the real finding.
- [ ] A run whose own changed files are clean passes autofix even when the repo carries out-of-diff `noNonNullAssertion` findings — pinned by a test.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the ready-gate autofix section: note scoping to changed files and the diagnostic-limit surfacing.
