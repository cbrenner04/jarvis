---
name: implement-stale-worktree-preflight-gates
---

# Implement re-run preflight refuses stale, dirty, and landed-tick worktrees

Problem A (2026-08-03, run `eabc39a7`): `resetStaleWorkspace` reused a managed worktree whose HEAD
lagged `--base` and held uncommitted tracked paths from an `iteration_timeout` run. The write step
read a fully ticked subspec, settled `no-work` → `completed`, and committed nothing. Root cause is
not established — reproduction lands before any fix.

## Decisions

- A failing regression against the stale-dirty reuse path lands before any fix — rules out patching an unproven cause.
- An implement re-run refuses or retires when managed worktree HEAD is not a descendant of resolved `--base`, independent of dirty state — rules out silently reusing a stale branch tip whose spec copy disagrees with base.
- `resetStaleWorkspace` gains a preserve gate before the existing reuse gates: refuse retirement when the worktree spec tree has criteria ticked that are unticked on `--base`, naming those subspec paths; an explicit override flag proceeds — rules out destroying landed subspec work during timeout recovery re-dispatch.
- Preserve gate runs before the stale/dirty reuse refusal; a worktree that is both dirty and carrying base-absent ticks names both conditions — rules out implicit gate-order races when two intents land separately.
- Descendant-check and preserve/reuse gates live only in `resetStaleWorkspace` / `maybeResetStaleWorkspace` — rules out duplicating the same refusal in the write-loop router.

## Acceptance criteria

- [ ] A regression drives the implement re-run preflight against a managed worktree whose HEAD is behind the resolved base and has uncommitted tracked paths, and asserts a refusal naming those paths; it fails against the current preflight.
- [ ] A regression asserts an implement re-run refuses when the managed worktree HEAD is not a descendant of the resolved `--base`, with a clean worktree, naming base and worktree HEAD.
- [ ] `resetStaleWorkspace` refuses to retire a workspace whose managed worktree spec tree has criteria ticked that are unticked on `--base`, names those subspec paths on stderr, and changes nothing; the documented override flag proceeds. A regression covers both.
- [ ] A worktree that is both dirty and carrying ticks absent from `--base` refuses with both conditions named — the preserve gate is checked before the reuse gate; a regression pins the order.
- [ ] Mutation checkpoint: a `// @mutate` directive inverting the descendant check turns its pinning test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — document the retirement refusal when landed criteria exceed `--base`, and its override flag.
- `v2/docs/v1-behaviors.md` — record the descendant-check preflight and preserve-before-reuse retirement gates.

## Prerequisites

- `resetStaleWorkspace` retires stale managed worktrees for implement and plan re-runs.
- `maybeResetStaleWorkspace` invokes `resetStaleWorkspace` before implement and plan write steps.
- Per-iteration commit checkpointing on every settled main-loop iteration.
- Implement routes to the first subspec with unticked non-human-only acceptance criteria.
