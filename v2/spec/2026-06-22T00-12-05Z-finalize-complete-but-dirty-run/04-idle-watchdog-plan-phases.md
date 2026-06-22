# 04 - Idle watchdog covers plan draft, review, and verdict-actuator phases

## Problem

Plan-mode agent-spawning phases — plan draft, plan review, and plan verdict-actuator (`v1/src/modes/plan/{draft,review,verdict-actuator}.ts`) — arm only the wall-clock timeout. A silent hang in any of them rides the full `iterationTimeoutMs`, the plan-mode analogue of the #339 review-actuator hang.

These phases live behind a **different invocation binding** than patch mode and run in a **different worktree** (`.worktree/plan-*`, not the patch worktree). Like the patch phases (subspec 03), none of them expose the `lastOutputAtMs` output-age signal today, so each needs its own output-age plumbing into its spawn wrapper plus reconciliation with its existing AbortController/timeout. This is split from the patch-side wiring because it spans an unrelated code path and a different working tree.

## Decisions

- Plumb an output-age signal into the plan draft, review, and verdict-actuator spawn wrappers, then arm subspec 00's `armIdleWatchdog` against it. Rules out leaving plan-mode on the wall-clock bound only.
- Pass the **plan worktree** (`.worktree/plan-*`) as the helper's scan working-directory. Rules out reusing the patch worktree path — plan phases edit a different tree, so a patch-tree scan would never see plan file activity and would false-kill productive plan work.
- Reconcile idle-abort with each phase's existing AbortController/wall-clock timeout rather than replacing it. Rules out dropping the wall-clock backstop.
- Reuse the same fire semantics as patch: exit `8` / `exitReason: "watchdog-idle-timeout"`, file-activity-aware liveness, default 600000 ms, `> 0` arming guard. Rules out per-phase divergent behavior.
- Requires subspecs 00, 01, and 03 merged first (03 establishes the per-phase wiring pattern this follows).

## Task checklist

- [ ] Plumb an output-age signal into the plan draft spawn wrapper; arm `armIdleWatchdog`, scanning the plan worktree.
- [ ] Plumb an output-age signal into the plan review spawn wrapper; arm `armIdleWatchdog`, scanning the plan worktree.
- [ ] Plumb an output-age signal into the plan verdict-actuator spawn wrapper; arm `armIdleWatchdog`, scanning the plan worktree.
- [ ] Reconcile the idle abort with each phase's existing AbortController/wall-clock timeout.
- [ ] Per-phase tests: a silent hang in plan draft, plan review, and plan verdict-actuator each aborts on the idle bound with `watchdog-idle-timeout`, not the wall-clock bound; a silent-but-file-editing agent within the window is not killed.

## Acceptance criteria

- [ ] A silent hang in plan draft (no output, no file activity) aborts with exit `8` / `exitReason: "watchdog-idle-timeout"` on the idle bound, before `iterationTimeoutMs`.
- [ ] A silent hang in plan review aborts on the idle bound.
- [ ] A silent hang in plan verdict-actuator aborts on the idle bound.
- [ ] In each plan phase, a silent-but-file-editing agent within the idle window (writing under the plan worktree) is not killed.

## Documentation updates

- `v1/docs/run-loop.md` — "Idle-output watchdog": coverage now also spans plan draft, review, and verdict-actuator.
- `v2/docs/v1-behaviors.md` — idle-watchdog section: applies to every agent-spawning phase, including plan draft/review/verdict-actuator.
