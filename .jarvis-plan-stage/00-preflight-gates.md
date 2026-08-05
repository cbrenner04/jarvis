# Preflight gates

## Problem

Run `eabc39a7` (2026-08-03): an implement re-run reused a managed worktree whose HEAD
lagged the resolved `--base` and held uncommitted tracked paths from an `iteration_timeout`
run. The write step read a fully ticked subspec copy, settled `no-work` → `completed`, and
committed nothing. Root cause is unproven — a failing regression lands before any fix.

Two opposing gates attach to the same `resetStaleWorkspace` / `maybeResetStaleWorkspace`
preflight: **preserve** landed criteria before retirement, and **refuse reuse** of a
stale/dirty/non-descendant worktree. Precedence is fixed here (preserve before reuse), not
by landing order.

## Decision ledger

- Failing regression against the stale-dirty reuse path lands before any fix — rules out patching an unproven cause.
- Implement re-run refuses when managed worktree HEAD is not a descendant of resolved `--base`, independent of dirty state — rules out silently reusing a stale branch tip whose spec copy disagrees with base; retirement is not an alternative outcome.
- `resetStaleWorkspace` gains a **preserve gate before** the existing stale/dirty reuse gate: refuse retirement when the worktree spec tree has acceptance criteria ticked that are unticked on `--base`, naming those subspec paths; `--reset-despite-landed-criteria` proceeds. Dirty-gate override stays `--reset-despite-dirty` — rules out overloading one flag for two conditions.
- Preserve gate runs before the reuse refusal; a worktree both dirty and carrying base-absent ticks names **both** conditions — rules out implicit gate-order races.
- Descendant-check and preserve/reuse gates live only in `resetStaleWorkspace` / `maybeResetStaleWorkspace` — rules out duplicating refusal in the write-loop router. Plan re-runs share the gates via `maybeResetStaleWorkspace`; ACs pin implement re-run.

## Prerequisites

- `resetStaleWorkspace` retires stale managed worktrees on implement/plan re-runs via `maybeResetStaleWorkspace`, before the write step.
- Incomplete git-enabled implement/plan re-run already refuses `resetStaleWorkspace` when the managed worktree is dirty (`--reset-despite-dirty` overrides dirty refusal only).

## Task checklist

- Land failing regression reproducing run `eabc39a7`'s stale-dirty reuse preflight (HEAD behind `--base`, uncommitted tracked paths); assert refusal naming those paths.
- Add descendant-of-`--base` refusal (clean worktree); stderr names resolved base and worktree HEAD.
- Add preserve gate comparing worktree vs `--base` spec-tree criteria ticks; wire `--reset-despite-landed-criteria` on implement/plan workflow CLI (same seam as `--reset-despite-dirty`).
- Pin preserve-before-reuse gate order when both landed-criteria drift and dirty/reuse conditions apply.
- Update operator runbook Recovery and `v1-behaviors.md` for preflight refusals and override flags.

## Acceptance criteria

- [ ] `workflow.test.ts` `run workflow implement refuses stale-dirty worktree reuse when HEAD lags base` drives incomplete git-enabled implement re-run against a managed worktree whose HEAD is behind the resolved `--base` with uncommitted tracked paths, asserts exit non-zero and stderr naming those paths with no daemon start; fails against current preflight.
- [ ] `workflow.test.ts` `run workflow implement refuses re-run when worktree HEAD is not a descendant of base` drives implement re-run with a clean managed worktree whose HEAD is not a descendant of resolved `--base`, asserts exit non-zero and stderr naming the base ref and worktree HEAD; fails against current preflight.
- [ ] `cleanup.test.ts` `reset refuses when worktree spec has criteria ticked absent from base` and `reset proceeds with reset-despite-landed-criteria when worktree spec has criteria ticked absent from base` cover preserve gate refusal (no retirement, subspec paths on stderr) and override proceed; fail against current `resetStaleWorkspace`.
- [ ] `cleanup.test.ts` `reset refusal names landed-criteria drift before dirty reuse when both apply` refuses with both conditions named and performs no retirement; fails against current gate order.
- [ ] `cleanup.test.ts` `reset refusal names landed-criteria drift before dirty reuse when both apply` links `// @mutate` inverting the preserve gate in `cleanup.ts`; inverting turns the test red.
- [ ] `workflow.test.ts` `run workflow implement refuses re-run when worktree HEAD is not a descendant of base` links `// @mutate` inverting the descendant check in `cleanup.ts`; inverting turns the test red.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — document descendant-check preflight refusal, preserve-before-reuse landed-criteria refusal, `--reset-despite-landed-criteria`, and gate order when both landed-criteria drift and dirty reuse apply; keep `--reset-despite-dirty` scoped to dirty refusal only.
- `v2/docs/v1-behaviors.md` — record descendant-check preflight, preserve-before-reuse gate, and `--reset-despite-landed-criteria`.
