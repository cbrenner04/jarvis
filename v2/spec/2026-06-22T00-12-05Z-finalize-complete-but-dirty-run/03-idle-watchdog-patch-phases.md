# 03 - Idle watchdog covers patch review and shrink phases

## Problem

The idle watchdog is wired only in `v1/src/modes/patch/iteration.ts`. Other patch-mode agent-spawning phases arm only the wall-clock timeout: the review actuator and debate (`v1/src/modes/patch/review.ts`) and shrink (`v1/src/modes/patch/shrink.ts`). Run #339 hung in the review actuator (`review: actuator running with verdict`, ~16 min silent) and rode the full 1800000 ms wall timeout because no idle watchdog covered that phase. Even with the watchdog defaulted on (subspec 01), a hang in review/shrink still rides `iterationTimeoutMs`.

This is not free reuse. The output-age signal (`lastOutputAtMs`) exists **only** in the patch iteration path; it is plumbed through that invocation binding and written on stdout/stderr chunks in the spawn layer. Review and shrink spawn through their own wrappers with no output-age ref, so each phase needs: (a) an output-age signal newly plumbed into its own spawn wrapper, and (b) the idle-abort reconciled with that phase's existing bespoke AbortController/timeout. Subspec 00's helper (taking output-age, file-activity, and scan working-directory as explicit inputs) is reused, but the per-phase wiring around it is the real work.

(Plan-mode phases are subspec 04 — they live behind a different invocation binding and in a different worktree.)

## Decisions

- Plumb an output-age signal into the review (debate + actuator) and shrink spawn wrappers, then arm subspec 00's `armIdleWatchdog` against it. Rules out leaving the idle bound patch-only (the #339 gap) and rules out assuming these phases already expose `lastOutputAtMs` (they do not).
- Reconcile idle-abort with each phase's existing AbortController/wall-clock timeout rather than replacing it. Rules out dropping the wall-clock bound, which still backstops file-noisy hangs (subspec 00 boundary).
- Pass the **patch worktree** as the helper's scan working-directory for these phases. Rules out a hardcoded directory — the scan dir is a per-phase parameter (plan phases in subspec 04 scan `.worktree/plan-*`).
- Each phase reuses the same fire semantics: abort with exit `8` / `exitReason: "watchdog-idle-timeout"`, file-activity-aware liveness, default 600000 ms, `> 0` arming guard (subspec 01). Rules out per-phase divergent timeout behavior.
- Requires subspecs 00 (helper + calibration) and 01 (default-on + `> 0` guard) merged first.

## Task checklist

- [ ] Plumb an output-age signal into the patch review debate and actuator spawn wrappers; arm `armIdleWatchdog` against it, scanning the patch worktree.
- [ ] Plumb an output-age signal into the shrink spawn wrapper; arm `armIdleWatchdog`, scanning the patch worktree.
- [ ] Reconcile the idle abort with each phase's existing AbortController/wall-clock timeout.
- [ ] Per-phase tests: a silent hang in review debate, review actuator, and shrink each aborts on the idle bound with `watchdog-idle-timeout`, not the wall-clock bound; a silent-but-file-editing agent within the window is not killed.

## Acceptance criteria

- [ ] A silent hang in the patch review actuator (no output, no file activity) aborts with exit `8` / `exitReason: "watchdog-idle-timeout"` on the idle bound, before `iterationTimeoutMs`.
- [ ] A silent hang in the patch review debate aborts on the idle bound.
- [ ] A silent hang in the shrink phase aborts on the idle bound.
- [ ] In each covered phase, a silent-but-file-editing agent within the idle window is not killed (file-activity liveness from subspec 00 applies uniformly).

## Documentation updates

- `v1/docs/run-loop.md` — "Idle-output watchdog": coverage now spans patch iteration, review (debate + actuator), and shrink.
- `v2/docs/v1-behaviors.md` — idle-watchdog section: applies to patch iteration, review, and shrink (plan phases in subspec 04).
