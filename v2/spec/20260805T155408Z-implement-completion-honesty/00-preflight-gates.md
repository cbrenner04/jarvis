# Preflight gates

## Problem

Run `eabc39a7` (2026-08-03): an implement re-run reused a managed worktree whose HEAD
lagged the resolved `--base` and held uncommitted tracked paths from an `iteration_timeout`
run. The write step read a fully ticked subspec copy, settled `no-work` → `completed`, and
committed nothing. Root cause is unproven — a failing regression lands before any fix.

Two opposing gates attach to the same `resetStaleWorkspace` / `maybeResetStaleWorkspace`
preflight: **preserve** landed criteria before retirement, and **refuse reuse** of a
stale/dirty/non-descendant worktree. Precedence is fixed here, not by landing order.

## Decision ledger

- Failing regression against the stale-dirty reuse path lands before any fix — rules out patching an unproven cause.
- **Gate sequence** on implement/plan re-run preflight (first matching refusal wins; combined stderr when several apply): **(1) descendant re-run refusal** — managed worktree HEAD must be a descendant of resolved `--base`, independent of dirty state; **(2) preserve landed criteria** — refuse retirement when the worktree spec tree has acceptance criteria ticked that are unticked on `--base`; **(3) dirty reuse refusal** — refuse retirement when the worktree has uncommitted tracked paths; **(4) retirement** — tear down stale workspace when gates pass.
- `--reset-despite-dirty` bypasses only gate (3); `--reset-despite-landed-criteria` bypasses only gate (2); neither overrides gate (1).
- When gates (2) and (3) both apply, stderr names landed-criteria drift before dirty reuse — rules out implicit gate-order races.
- Descendant-check and preserve/reuse gates live only in `resetStaleWorkspace` / `maybeResetStaleWorkspace` — rules out duplicating refusal in the write-loop router. Plan re-runs share the gates via `maybeResetStaleWorkspace`; ACs pin implement re-run.

## Prerequisites

- `resetStaleWorkspace` retires stale managed worktrees on implement/plan re-runs via `maybeResetStaleWorkspace`, before the write step.
- Incomplete git-enabled implement/plan re-run already refuses gate (3) when the managed worktree is dirty (`--reset-despite-dirty` overrides dirty refusal only).

## Task checklist

- Land failing regression for run `eabc39a7`'s neither-retired-nor-refused path: HEAD behind `--base`, uncommitted tracked paths, `--reset-despite-dirty` isolates gate (1) from gate (3); assert refusal, not reuse or retirement.
- Add descendant-of-`--base` refusal (clean worktree); stderr names resolved base and worktree HEAD.
- Add preserve gate comparing worktree vs `--base` spec-tree criteria ticks; wire `--reset-despite-landed-criteria` on implement/plan workflow CLI (same seam as `--reset-despite-dirty`).
- Pin full gate order when multiple conditions apply (descendant + preserve + dirty combinations).
- Update operator runbook Recovery and `v1-behaviors.md` for preflight refusals and override flags.

## Acceptance criteria

- [ ] `workflow.test.ts` `run workflow implement refuses stale reuse when HEAD lags base despite reset-despite-dirty` drives incomplete git-enabled implement re-run with `--reset-despite-dirty` against a managed worktree whose HEAD is behind the resolved `--base` with uncommitted tracked paths, asserts exit non-zero, stderr names those paths and stale/descendant reuse refusal, no daemon start, and no retirement; fails against current preflight (today gate (3) is bypassed and gate (1) is absent, so retirement proceeds).
- [ ] `workflow.test.ts` `run workflow implement refuses re-run when worktree HEAD is not a descendant of base` drives implement re-run with a clean managed worktree whose HEAD is not a descendant of resolved `--base`, asserts exit non-zero and stderr naming the base ref and worktree HEAD; fails against current preflight.
- [ ] `cleanup.test.ts` `reset refuses when worktree spec has criteria ticked absent from base` and `reset proceeds with reset-despite-landed-criteria when worktree spec has criteria ticked absent from base` cover preserve gate refusal (no retirement, subspec paths on stderr) and override proceed; fail against current `resetStaleWorkspace`.
- [ ] `cleanup.test.ts` `reset refusal names landed-criteria drift before dirty reuse when both apply` refuses with both conditions named in preserve-before-dirty order and performs no retirement; fails against current gate order.
- [ ] `workflow.test.ts` `run workflow implement refuses re-run when worktree HEAD is not a descendant of base` links `// @mutate v2/src/commands/cleanup.ts "isDescendantOfBase(worktreeHead, baseRef)" -> "true"`; inverting turns the test red.
- [ ] `cleanup.test.ts` `reset refusal names landed-criteria drift before dirty reuse when both apply` links `// @mutate v2/src/commands/cleanup.ts "landedCriteriaAbsentFromBase(specTree)" -> "false"`; inverting turns the test red.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — document gate sequence (descendant → preserve → dirty → retirement), descendant-check preflight refusal, preserve-before-reuse landed-criteria refusal, `--reset-despite-landed-criteria`, combined stderr when multiple gates fire; keep `--reset-despite-dirty` scoped to dirty refusal only.
- `v2/docs/v1-behaviors.md` — record descendant-check preflight, preserve-before-reuse gate, gate order, and `--reset-despite-landed-criteria`.
