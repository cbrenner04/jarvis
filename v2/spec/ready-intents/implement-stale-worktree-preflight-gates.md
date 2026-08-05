---
name: implement-stale-worktree-preflight-gates
---

# Implement re-run preflight refuses stale, dirty, and landed-tick worktrees

Problem A (2026-08-03, run `eabc39a7`): `resetStaleWorkspace` reused a managed worktree whose HEAD
lagged `--base` and held uncommitted tracked paths from an `iteration_timeout` run. The write step
read a fully ticked subspec, settled `no-work` → `completed`, and committed nothing. Root cause is
not established — reproduction lands before any fix.

## Bundle

`seeds/implement-completion-honesty` and `implement-queue.md` call for one spec; this bundle fans
out to three serial intents by module boundary (preflight → write-loop → daemon projection).
Promotion order is fixed: this intent first, then `refuse-false-completed-write-loop-settlements`,
then `project-completion-honesty-on-run-results`. Plan drafts one ordered spec from the three.

## Decisions

- A failing regression against the stale-dirty reuse path lands before any fix — rules out patching an unproven cause.
- An implement re-run refuses when managed worktree HEAD is not a descendant of resolved `--base`, independent of dirty state — rules out silently reusing a stale branch tip whose spec copy disagrees with base; retirement is not an alternative outcome.
- `resetStaleWorkspace` gains a preserve gate before the existing reuse gates: refuse retirement when the worktree spec tree has criteria ticked that are unticked on `--base`, naming those subspec paths; `--reset-despite-landed-criteria` on implement/plan proceeds — rules out destroying landed subspec work during timeout recovery re-dispatch. Dirty-gate override stays existing `--reset-despite-dirty` — rules out overloading a dirty-only flag for landed-criteria retirement.
- Preserve gate runs before the stale/dirty reuse refusal; a worktree that is both dirty and carrying base-absent ticks names both conditions — rules out implicit gate-order races when two intents land separately.
- Descendant-check and preserve/reuse gates live only in `resetStaleWorkspace` / `maybeResetStaleWorkspace` — rules out duplicating the same refusal in the write-loop router. Plan re-runs share the same gates via `maybeResetStaleWorkspace`; this intent pins implement re-run ACs only.

## Acceptance criteria

- [ ] A regression drives the implement re-run preflight against a managed worktree whose HEAD is behind the resolved base and has uncommitted tracked paths, and asserts a refusal naming those paths; it fails against the current preflight.
- [ ] A regression asserts an implement re-run refuses when the managed worktree HEAD is not a descendant of the resolved `--base`, with a clean worktree, naming base and worktree HEAD.
- [ ] `resetStaleWorkspace` refuses to retire a workspace whose managed worktree spec tree has criteria ticked that are unticked on `--base`, names those subspec paths on stderr, and changes nothing; `--reset-despite-landed-criteria` proceeds. A regression covers both.
- [ ] A worktree that is both dirty and carrying ticks absent from `--base` refuses with both conditions named — the preserve gate is checked before the reuse gate; a regression pins the order.
- [ ] Mutation checkpoint: a `// @mutate` directive inverting the descendant check turns its pinning test RED.
- [ ] Mutation checkpoint: a `// @mutate` directive inverting the preserve gate turns its pinning test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — document implement re-run refusals when HEAD is not a descendant of `--base`, when HEAD is behind base with uncommitted tracked paths, and when landed criteria exceed `--base`; document `--reset-despite-landed-criteria`.
- `v2/docs/v1-behaviors.md` — record the descendant-check preflight and preserve-before-reuse retirement gates.

## Prerequisites

- `resetStaleWorkspace` retires stale managed worktrees on implement re-runs (plan shares the path but is unpinned here).
- `maybeResetStaleWorkspace` invokes `resetStaleWorkspace` before implement write steps.
- Per-iteration commit checkpointing on every settled main-loop iteration.
- Implement routes to the first subspec with unticked non-human-only acceptance criteria.
