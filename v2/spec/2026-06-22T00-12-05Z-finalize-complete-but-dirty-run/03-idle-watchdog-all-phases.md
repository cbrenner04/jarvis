# 03 - Idle watchdog covers review, shrink, and plan phases

## Problem

The idle watchdog is wired only in `v1/src/modes/patch/iteration.ts`. Other agent-spawning phases arm only the wall-clock timeout: the patch review actuator (`v1/src/modes/patch/review.ts`), shrink (`v1/src/modes/patch/shrink.ts`), and plan draft/review/verdict-actuator (`v1/src/modes/plan/{draft,review,verdict-actuator}.ts`). Run #339 hung in the review actuator (`review: actuator running with verdict`, ~16 min silent) and rode the full 1800000 ms wall timeout because no idle watchdog covered that phase. Even with the watchdog defaulted on (subspec 01), a hang in review/shrink/plan still rides `iterationTimeoutMs`.

Reuse the calibrated, file-activity-aware helper extracted in subspec 00 so a silent hang in any phase dies on the idle bound, not the wall-clock bound.

## Decisions

- Wire subspec 00's `armIdleWatchdog` helper into every agent-spawning phase: patch review (debate + actuator), shrink, and plan (draft, review, verdict-actuator). Rules out leaving the idle bound patch-only (the #339 gap).
- Each phase reuses the same fire semantics: abort with exit `8` / `exitReason: "watchdog-idle-timeout"`, file-activity-aware liveness, default 600000 ms. Rules out per-phase divergent timeout behavior.
- Requires subspecs 00 (helper + calibration) and 01 (default-on) merged first.

## Task checklist

- [ ] Arm the idle watchdog (00's helper) in the patch review debate and actuator spawns.
- [ ] Arm it in the shrink agent spawn.
- [ ] Arm it in plan draft, plan review, and plan verdict-actuator spawns.
- [ ] Per-phase tests: a silent hang in each phase aborts on the idle bound with `watchdog-idle-timeout`, not on the wall-clock bound.

## Acceptance criteria

- [ ] A silent hang in the patch review actuator (no output, no file activity) aborts with exit `8` / `exitReason: "watchdog-idle-timeout"` on the idle bound, before `iterationTimeoutMs`.
- [ ] A silent hang in the patch review debate aborts on the idle bound.
- [ ] A silent hang in the shrink phase aborts on the idle bound.
- [ ] A silent hang in plan draft, plan review, and plan verdict-actuator each abort on the idle bound.
- [ ] In every covered phase, a silent-but-file-editing agent within the idle window is not killed (file-activity liveness from subspec 00 applies uniformly).

## Documentation updates

- `v1/docs/run-loop.md` — "Idle-output watchdog": coverage now spans patch iteration, review (debate + actuator), shrink, and plan phases.
- `v2/docs/v1-behaviors.md` — idle-watchdog section: applies to every agent-spawning phase, not just patch iteration.
