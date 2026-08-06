---
name: successor-step-idle-watchdog
---

# Successor step idle watchdog

Splitting does not apply: reproduction, watchdog settlement, and branch-claim release all land on the execution-loop successor-step boundary.

## Module-boundary surface

- Execution loop: review/shrink/publication successor dispatch after write-step settlement.

## Problem

- A workflow-started implement spawns a review, shrink, or publication successor as its own run row; it emits `iteration_started` then produces no further events for tens of minutes while `run list` reports it live; the idle-output watchdog never fires; the row holds the `(project, branch)` claim and blocks re-run until manual `jarvis run kill`.

## Decisions

- Candidate loci (bounded hypotheses, not yet confirmed): successor dispatch arms no idle-output watchdog after `iteration_started` (unlike the write step), or the stall occurs before any agent invocation so existing `roleTimeoutMs` never arms — rules out shipping a fix at an unrelated seam.
- Reproduce the stalled successor synthetically — rules out replaying the 2026-08-04 production runs.
- Arm successor idle-output bounds from machine `idleOutputTimeoutMs` after `iteration_started`, fencing pre-agent stalls; defer successor wall-clock bounds — `roleTimeoutMs` already covers review-role invocations once started — rules out agent-only scope, unbounded successors, or duplicating wall-clock policy in this change.
- Idle-budget exhaustion settles a named non-live failure (`role_stalled` or equivalent) — rules out hanging live until operator kill.
- Terminal successor settlement releases the `(project, branch)` claim so re-run proceeds — rules out a wedged branch.
- Write-step watchdogs and `jarvis run kill` classifier gate stay out of scope — rules out unrelated harness work.

## Acceptance criteria

- [ ] `successor-step-idle-watchdog.test.ts` reproduces a review/shrink/publication successor that emits `iteration_started` and then no output, asserts today's behavior leaves it live and unbounded, and fails once the idle-output watchdog is armed.
- [ ] `successor-step-idle-watchdog.test.ts` asserts a successor with no output for the idle budget settles a named non-live failure, `run list`/`wait` report it, and the branch claim is released.
- [ ] Mutation checkpoint: `successor-step-idle-watchdog.test.ts` — a `// @mutate` directive disabling the successor idle-output watchdog turns the pinning test RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust / Recovery — record successor-step idle-output watchdog bounds; remove settled-run-row/live-successor manual-kill guidance once shipped.
- `v2/docs/v1-behaviors.md` — record the successor-step idle-output watchdog.

## Prerequisites

- The successor-step dispatch path after write-step settlement (review/shrink/publication).
- The write step's existing idle-output watchdog (`idleOutputTimeoutMs`) as the model to extend.
- `implement-completion-honesty` landed (synthetic repro, not 2026-08-04 replay).
