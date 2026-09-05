---
name: implement-admission-persists-its-run-row
---

# Implement admission returns a run id whose row was never persisted

## Problem

2026-09-06: `jarvis run workflow implement --base main --spec v2/spec/20260902T051154Z-pipeline-resume-recover-stale-reset-override-flags/index.md --detach` printed `a0496220-935b-45e6-b01c-ccf3ef7323af` and exited `0`. No run row with that id ever existed: `jarvis run wait a0496220…` returned `unknown_run: Run … not found`, `run list --branch <spec>` showed only prior-session rows, and the daemon log recorded exactly one line — `Workflow execution failed (implement): Run a0496220-935b-45e6-b01c-ccf3ef7323af not found`.

The lane was silently lost. Detach's documented contract (`exit 0` means admitted) held while nothing was admitted; no operator incident fired; the only evidence was a grep of the keyed daemon log.

The worktree at that path was **not** a descendant of `--base main` (worktree `HEAD` `6e0828de`, merge-base `4739fe84`) — the exact state that made two sibling launches in the same batch refuse cleanly with `Cannot re-run incomplete spec: worktree HEAD … is not a descendant of base main; stale reuse refused`. That worktree additionally carried a `review-debate(1)` commit and a spec tree with all four criteria ticked while `main` had two unticked. After `jarvis cleanup --yes --abandon <branch>`, the identical command admitted normally and persisted its row.

## Decisions

- Admission either persists the run row before returning an id, or returns a named refusal; rules out a printed id no verb can reach (same honesty mechanism as [[linked-run-rows-resume-and-settle-uniformly]]).
- A workflow whose entry row cannot be resolved settles an operator-visible failure (durable row and/or incident), not a daemon-log-only line; rules out silent lane loss under `--detach`.
- The preflight gate set evaluates the descendant check on this worktree shape too — a non-descendant `HEAD` refuses before admission regardless of the worktree's ticked-criteria or review-commit state; rules out one stale shape bypassing the gate that its siblings hit.

## Acceptance criteria

- [ ] A test proves implement admission that fails to persist its entry row returns a named refusal and a non-zero exit instead of printing a run id.
- [ ] A test proves a workflow execution failing with an unresolvable entry run id records a durable operator-visible failure, not only a daemon process-log line.
- [ ] A preflight test proves a worktree whose `HEAD` is not a descendant of `--base` refuses with `stale reuse refused` even when its spec tree has criteria ticked that `--base` does not; fails against the observed bypass.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — admission persistence contract for the entry run row.
- `v2/docs/operator-runbook.md` — detach exit-0 caveat and the `Run … not found` diagnosis.
