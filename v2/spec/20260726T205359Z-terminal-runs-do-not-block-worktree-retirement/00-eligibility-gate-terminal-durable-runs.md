# 00 - Eligibility gate uses terminal durable status

## Problem

`checkEligibility` (`v2/src/commands/cleanup.ts`) blocks on any durable row that is not
**boundary-terminal** (`isBoundaryTerminalRunStatus`). Only **`killed`** is terminal for the row but
not boundary-terminal today — **`interrupted`** already passes the boundary predicate. Reconciled
post-bounce **`killed`** rows (and JSDoc that says “non-terminal durable run” while the gate uses the
boundary predicate) make merged worktrees permanently ineligible and specs on those branches
unarchivable until `--abandon`.

## Decisions

- Durable blocking rule: any `(project, branch)` row with a **non-terminal** store `RunStatus` blocks;
  use **`isTerminalRunStatus`** from `state-store.ts` (negated), not `isBoundaryTerminalRunStatus`,
  not daemon/TUI “terminal” notions, and not `TERMINAL_LIST_STATUSES`. Rules out swapping the wrong
  helper for a one-line gate change.
- Leave `isBoundaryTerminalRunStatus` and its existing callers unchanged. Rules out widening or
  narrowing boundary-terminal semantics to fix cleanup.
- Daemon `isLive` probe in `checkEligibility` stays a separate gate after the store scan. Rules out
  inferring liveness from durable status or dropping the probe.
- Live `.jarvis.lock` refusal stays in `isWorktreeLiveHeld` for **`runAbandonCommand`** (and
  stale-reset parity), not in `checkEligibility` — bulk retirement uses the eligibility gate only.
  Rules out folding lock into `checkEligibility` or removing lock checks while touching eligibility.
- Fail-closed unchanged: **`gh` failure** and **daemon unreachable** → `{ status: "ineligible" }`.
  **`listRuns()` throw** → propagates (fail-closed by aborting cleanup); do not swallow into
  ineligible. Rules out fail-open and rules out changing store-error semantics to match gh/daemon in
  this spec.
- Align `checkEligibility` JSDoc and operator-runbook fail-closed wording with the split above (gh/daemon
  ineligible; store throw propagates).

## Tasks

- [ ] In `checkEligibility`, block only when `listRuns()` finds a matching row with
      `!isTerminalRunStatus(status)` (import from `state-store.ts`).
- [ ] In `eligibility-gate.test.ts`, update **`correctly distinguishes terminal vs non-terminal
      statuses`**: move **`killed`** and every status in **`TERMINAL_RUN_STATUSES`** to the eligible
      loop; keep `in-progress`, `paused`, `queued`, and `budget-soft-stopped` in the ineligible loop.
      Optionally drop invalid loop entries (`revising`, `awaiting-human`) when touching the test.
      Add **`interrupted`** in the eligible loop only as regression / no-op coverage (not the bug
      narrative). Add cases for live daemon with all terminal durable rows; invert guards per AC.
- [ ] Add or extend `cleanup.test.ts` so **`runAbandonCommand`** refuses when a live holder owns
      `~/.jarvis/worktree-locks/<project>/<branch>/.jarvis.lock` (mirror the existing daemon
      `isLive` abandon refusal test) — preserves abandon behavior, not evidence for the durable
      predicate change.
- [ ] Sync `checkEligibility` JSDoc and `v2/docs/operator-runbook.md` § Cleanup: eligibility gate
      fail-closed text with gh/daemon ineligible vs store throw propagation.
- [ ] Update documentation listed below.

## Acceptance criteria

- [ ] `eligibility-gate.test.ts` **`correctly distinguishes terminal vs non-terminal statuses`**
      expects merged + durable **`killed`** → eligible; the test fails against the pre-fix gate that
      uses `isBoundaryTerminalRunStatus`.
- [ ] The same test asserts each of `in-progress`, `paused`, `queued`, `budget-soft-stopped` →
      ineligible when merged; inverting the terminal-status guard (treat `killed` as blocking again)
      fails at least one of these cases.
- [ ] `eligibility-gate.test.ts` asserts merged + only terminal durable rows + daemon client
      returning `isLive: true` → ineligible; inverting the daemon guard makes the case eligible.
- [ ] `cleanup.test.ts` asserts `runAbandonCommand` refuses with live `.jarvis.lock` held and
      removes nothing; inverting the lock-alive guard makes abandon proceed.
- [ ] `eligibility-gate.test.ts` **`returns ineligible if gh command fails`** stays green.
- [ ] `eligibility-gate.test.ts` **`returns ineligible if store throws`** stays green (store errors
      propagate; fail-closed via abort).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Cleanup: eligibility gate — durable block is **non-terminal**
  statuses only (`TERMINAL_RUN_STATUSES` complement); remove `killed` from the blocking list; note
  `--abandon` was the operator workaround before this shipped. Fail-closed: gh and daemon →
  ineligible; store inaccessible → error propagates (worktree skipped because cleanup aborts).
- `v2/docs/v1-behaviors.md` — extend the existing bulk-`cleanup` paragraph and/or add a **[v2
  difference]** cleanup bullet: merged worktree retirement eligibility no longer blocks on durable
  rows whose status is in **`TERMINAL_RUN_STATUSES`** (including **`killed`**); non-terminal rows
  still block.
