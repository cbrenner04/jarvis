# 00 - Reset prior-attempt source-spec mutations on no-commit re-run

## Problem

In a no-commit run (`gitEnabled: false`, where the active spec **is** the source spec — no
worktree copy), a friction-blocked or interrupted attempt mutates the source spec and
nothing reverts it: AC checkboxes the agent ticked stay ticked, and the agent's `## Blocker`
stays appended. Re-running then either skips already-ticked work or hard-stops at the
start-of-iteration blocker check (`iteration.ts:397-412`, exit 7). The operator must
hand-revert checkboxes and strip the stale blocker before each retry. On groceries, where
re-runs (often after a mid-attempt Ctrl-C) were the common case, this dominated babysitting.

This is the no-commit case only. Under `gitEnabled: true`, mutations land on a worktree copy
and are committed; git already reverts/tracks them. The source spec is never touched there.

## Decisions

- Gate the whole feature on the existing `gitEnabled` flag (false ⇒ active spec is the source spec); drop any separate active-path-equals-source-path check — `gitEnabled` already encodes it. Ruling out a redundant second gate that could disagree with the code's own flag.
- Reuse the existing run-start AC snapshot + per-run `newlyChecked` delta (`diffAcceptanceCriteria` output, AC keyed by their text per the existing patch-mode convention) — do not design new identity machinery. The persisted record is that key-set plus the newly-appended `## Blocker`, not a full pre-attempt snapshot. Recording the delta (not a whole-spec baseline diff) is what avoids reverting authored ticks made between runs.
- "Attempt" = run-cumulative: the delta is the set of AC newly ticked (and the blocker appended) over the **whole run** measured against run-start state, across every fix-up / blocker-claim-rejection iteration — not the last iteration's before/after.
- The delta is keyed by the active spec path. Scope it to the active subspec(s) actually mutated this run; a no-commit index-checkbox flip is out of scope (single-subspec runs assumed — Jarvis selects one active subspec per run).
- Persist incrementally as ticks/blocker mutations occur, so a mid-attempt Ctrl-C/kill still leaves a recorded delta — capture must not depend on a graceful incomplete exit. Stored in jarvis-owned state outside the target repo and outside the spec tree (each `jarvis1 run` is a fresh process; the record must not pollute or be committed into the spec).
- Lifecycle order: load + reset prior delta → run → on incomplete, record **this** run's fresh delta → on clean completion, clear the record. A reset-then-incomplete-again run replaces the old record with the new one (the clear-after-reset and clear-after-completion steps must not wipe a freshly recorded delta).
- Apply the reset before the start-of-iteration `## Blocker` → exit-7 check — otherwise a stale prior-attempt blocker still short-circuits the re-run the operator is trying to unblock.
- An AC whose wording the operator edits between runs fails safe: the recorded key no longer matches, so the reset reverts nothing rather than the wrong line (guarded by "only those still ticked / only if still the attempt's").
- Auto-reset is the default re-run path; no `--retry`/`--fresh` flag — the motivation is removing manual steps for the single operator, and the reset is surgical (reverts only the recorded delta). The explicit-affordance alternative was weighed and rejected as added friction.
- Accepted edge: operator re-ticking a criterion the prior attempt also ticked is reverted (indistinguishable from the attempt's own tick) — rare.
- Accepted edge: auto-reset erases the prior `## Blocker` even when it described a still-valid environmental block — defensible because the operator chose to re-run.

Deferred to first consumer: exact state filename/location under jarvis-owned storage — pin when implementing.

## Task checklist

- [ ] Persist the run-cumulative delta (newly-ticked AC keys from `newlyChecked` + newly-appended `## Blocker`) incrementally as mutations occur, so an interrupted/killed no-commit run still leaves a record; key by active spec path in jarvis-owned state.
- [ ] On a no-commit run start, load any recorded delta and, before the blocker-detection/exit-7 path, un-tick the recorded AC (only those still ticked) and strip the recorded blocker (only if still the attempt's).
- [ ] Order the lifecycle: load+reset prior delta → run → record this run's delta on incomplete → clear on clean completion, without wiping a freshly recorded delta.
- [ ] Leave `gitEnabled: true` runs unchanged (no capture, no reset).
- [ ] Tests + docs below.

## Acceptance criteria

- [x] A `gitEnabled: false` run that ends incomplete records its run-cumulative source-spec delta — the AC checkboxes it ticked and the `## Blocker` it appended — in jarvis-owned state outside the target repo.
- [x] An interrupted (Ctrl-C/killed) `gitEnabled: false` run still leaves the delta recorded for the next run to reset (capture does not require a graceful exit).
- [x] On re-run of that incomplete no-commit spec, jarvis reverts exactly those still-ticked AC checkboxes and strips that attempt's `## Blocker` before invoking the agent.
- [x] A no-commit re-run whose only stale change is a prior-attempt `## Blocker` proceeds into the run (does not exit 7), because the reset runs before the start-of-iteration blocker detection.
- [x] AC checkboxes present in the pre-attempt (authored) state remain ticked after the reset; only the recorded prior-attempt delta is reverted.
- [x] A no-commit run that completes cleanly leaves no persisted delta and triggers no reset on a later unrelated run.
- [x] A `gitEnabled: true` worktree-backed run records no delta and applies no reset (behavior unchanged).
- [x] New tests cover: delta capture on an incomplete and on an interrupted no-commit run, AC reversion + blocker strip on the next no-commit run, preservation of a pre-attempt authored tick across the reset, and a clean completion leaving no record.

## Documentation updates

- [x] `v1/docs/run-loop.md` — document the no-commit re-run auto-reset (delta capture on incomplete exit; AC revert + blocker strip before the next attempt's blocker check).
- [x] `v2/docs/v1-behaviors.md` — record the new no-commit re-run reset behavior (this changes existing v1 behavior: stale-blocker exit-7 and persistent AC ticks on no-commit re-runs).
- [x] `v1/docs/operator-runbook.md` — note that no-commit re-runs no longer require hand-reverting checkboxes or stripping the prior `## Blocker`.
