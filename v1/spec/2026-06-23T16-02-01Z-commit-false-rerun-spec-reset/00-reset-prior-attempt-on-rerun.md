# 00 - Reset prior-attempt source-spec mutations on no-commit re-run

## Problem

In a no-commit patch run (effective `git: false`, where the active spec **is** the
source spec — no worktree copy), a friction-blocked attempt mutates the source spec and
nothing reverts it: AC checkboxes the agent ticked stay ticked, and the agent's `## Blocker`
stays appended. Re-running then either skips already-ticked work or hard-stops at the
start-of-iteration blocker check (`iteration.ts:397-412`, exit 7). The operator must
hand-revert checkboxes and strip the stale blocker before each retry. On groceries, where
re-runs were the common case, this dominated babysitting.

This is the no-commit case only. Under `git: true`, mutations land on a worktree copy and
are committed; git already reverts/tracks them. The source spec is never touched there.

## Decisions

- Scope the reset to no-commit runs where the active spec path equals the source spec path (effective `git: false`) — not git:true worktree-backed runs, where git already handles reversion.
- Distinguish prior-attempt ticks from operator/committed ticks by recording the attempt's own delta (which AC it newly ticked, which `## Blocker` it newly appended), not by diffing the whole spec against a stored baseline — a baseline diff would revert operator ticks made between runs.
- Persist the attempt delta in jarvis-owned state keyed to the resolved spec path, outside the target repo and outside the spec tree — each `jarvis1 run` is a fresh process with no in-memory carryover, and the record must not pollute or be committed into the spec.
- Apply the reset before the start-of-iteration `## Blocker` → exit-7 check — otherwise a stale prior-attempt blocker still short-circuits the re-run the operator is trying to unblock.
- Auto-reset is the default re-run path; no `--retry`/`--fresh` flag — the motivation is removing manual steps for the single operator, and the reset is surgical (reverts only the recorded delta). The explicit-affordance alternative was weighed and rejected as added friction.
- Operator re-ticking a criterion the prior attempt also ticked is reverted (indistinguishable from the attempt's own tick); accepted edge — operator re-ticks, rare.

Deferred to first consumer: exact state filename/location under jarvis-owned storage — pin when implementing.

## Task checklist

- [ ] Capture the attempt delta (newly-ticked AC keys + newly-appended `## Blocker`) when a no-commit run ends incomplete; persist to jarvis-owned state keyed by resolved spec path.
- [ ] On a no-commit run start, load any recorded delta and, before the blocker-detection/exit-7 path, un-tick the recorded AC (only those still ticked) and strip the recorded blocker (only if still the attempt's).
- [ ] Clear/refresh the persisted delta after a successful reset and after run completion.
- [ ] Leave git:true runs unchanged (no capture, no reset).
- [ ] Tests + docs below.

## Acceptance criteria

- [ ] A no-commit (effective `git: false`) patch run that ends incomplete records the prior attempt's source-spec delta — the AC checkboxes it ticked and the `## Blocker` it appended — in jarvis-owned state outside the target repo.
- [ ] On re-run of that incomplete no-commit spec, jarvis reverts exactly those still-ticked AC checkboxes and strips that attempt's `## Blocker` before invoking the agent.
- [ ] A no-commit re-run whose only stale change is a prior-attempt `## Blocker` proceeds into the run (does not exit 7), because the reset runs before the start-of-iteration blocker detection.
- [ ] AC checkboxes present in the pre-attempt (operator/committed) state remain ticked after the reset; only the recorded prior-attempt delta is reverted.
- [ ] A `git: true` worktree-backed run records no delta and applies no reset (behavior unchanged).
- [ ] New tests cover: delta capture on an incomplete no-commit exit, AC reversion + blocker strip on the next no-commit run, and preservation of a pre-attempt operator tick across the reset.

## Documentation updates

- [ ] `v1/docs/run-loop.md` — document the no-commit re-run auto-reset (delta capture on incomplete exit; AC revert + blocker strip before the next attempt's blocker check).
- [ ] `v2/docs/v1-behaviors.md` — record the new no-commit re-run reset behavior (this changes existing v1 behavior: stale-blocker exit-7 and persistent AC ticks on no-commit re-runs).
- [ ] `v1/docs/operator-runbook.md` — note that no-commit re-runs no longer require hand-reverting checkboxes or stripping the prior `## Blocker`.
