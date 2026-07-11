# 00 - Recover a timed-out subspec

## Decisions

- Recovery is a dedicated callable plan action taking a spec tree and selected subspec; ordinary patch and `plan --resume` never select or rewrite from timeout history.
- Deferred to first consumer: recovery action spelling and timeout-history presentation — pin when an operator invokes recovery.
- A qualifying record is a `runs.jsonl` patch `run_terminal` timeout for the selected subspec with `exit_reason` `iteration-timeout` or `watchdog-iteration-timeout`; idle, run, non-terminal, malformed, and other-subspect records do not qualify.
- One qualifying record makes an unchecked, uniquely linked in-tree subspec eligible, rather than requiring the three-consecutive-timeout blocker; the blocker remains the patch-run signal after three consecutive qualifying timeouts.
- Recovery rejects missing, malformed, duplicate, completed, or out-of-tree index targets before drafting, rather than choosing an ambiguous file or mutating the tree.
- Recovery refuses a selected subspec with a pending, malformed, or mismatched timeout-checkpoint receipt or retained checkpoint work; the operator must resume or explicitly abandon that patch work first, rather than losing or applying it to replacements.
- Recovery uses a new spec-only plan branch, worktree, and draft PR rooted at the selected tree; it does not reuse ordinary `--resume`'s existing plan branch/worktree/PR lifecycle.
- Recovery commits and pushes only the validated replacement tree; the selected tree changes only when the recovery PR merges, rather than during recovery setup.
- Replacements are drafted from the original subspec, its index position, intent, linked dependencies, and timeout evidence, rather than from the timeout alone.
- Recovery stages two or more collision-safe numbered sibling replacements, deletes the old file, and replaces its unchecked index entry at the same position with unchecked entries; completed neighbors remain unchanged.
- Recovery rewrites supported relative Markdown links to the old subspec in numbered subspec files and the index only when a replacement target is unambiguous; ambiguous structured links reject recovery, while arbitrary prose is not rewritten.
- Recovery validates the staged result with normal spec-tree validation before committing; drafting or validation failure leaves the original tree and its plan state untouched.
- `iterationTimeoutMs` remains unchanged, rather than treating recovery as timeout tuning.
- `v2/docs/v1-behaviors.md` is the canonical recovery-semantics record; `v1/docs/plan-mode.md` documents operator invocation and links to it, rather than duplicating lifecycle rules.
- Replace the manual-surgery stopgap in `v1/docs/operator-runbook.md` with recovery boundaries, rather than removing recovery guidance altogether.

## Task checklist

- Add the explicit recovery action and its separate plan/branch/worktree/draft-PR lifecycle.
- Validate timeout evidence, target shape, and checkpoint safety before any recovery mutation.
- Draft, reconcile, and validate an atomic replacement tree.
- Cover recovery and the preserved ordinary-resume path.
- Update the required durable docs.

## Acceptance criteria

- [ ] An operator can invoke recovery for one qualifying terminal iteration-timeout record; patch runs and ordinary `jarvis1 plan --resume` leave timed-out subspecs unchanged.
- [ ] Recovery refuses missing, malformed, idle, run, non-terminal, or other-subspec timeout evidence; malformed, duplicate, completed, missing, and out-of-tree targets; and pending or unsafe timeout-checkpoint work, without changing the selected tree.
- [ ] Recovery opens a separate spec-only plan branch, worktree, and draft PR, then atomically replaces the selected unchecked task with two or more independently testable collision-safe sibling subspecs; completed neighbors, index order/check state, and resolvable supported structured links are preserved, and the replaced file has no stale structured target.
- [ ] Drafting or normal spec-tree validation failure leaves the original tree and plan state intact.
- [ ] Automated coverage proves explicit invocation, evidence/target/checkpoint refusals, replacement reconciliation and atomicity; `v1/test/plan-command.test.ts` resume coverage stays green.
- [ ] `v2/docs/v1-behaviors.md` canonically records recovery, evidence, checkpoint, lifecycle, and three-timeout-blocker boundaries; `v1/docs/plan-mode.md` documents invocation and links to it; `v1/docs/operator-runbook.md` replaces manual surgery with the supported recovery boundary.

## Documentation updates

- Update `v1/docs/plan-mode.md`.
- Update `v2/docs/v1-behaviors.md`.
- Remove the manual subspec-split stopgap from `v1/docs/operator-runbook.md`.
