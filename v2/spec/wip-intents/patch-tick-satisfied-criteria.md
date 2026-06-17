# Patch run completes work that is already satisfied but unticked

**Scope.** v1 harness work — `v1/src/modes/patch/**` (rules + run loop), docs.
Lives in `v2/spec/wip-intents/` for routing.

## Problem

A patch iteration that finds the active subspec's work already done but its
`## Acceptance criteria` still unticked stalls instead of finishing. Jarvis
gauges progress by checkbox transitions, so an iteration that ticks nothing exits
`no-progress` (code 4) — even when every criterion is genuinely satisfied. The
completed work is stranded: no completing commit, no PR, no review.

Observed on the prerequisite-enforcement spec: an earlier iteration left failing
tests, the operator fixed them by hand (the `WIP 00` commit), and the next
iteration re-verified everything passed but never ticked the criteria. Result:
`iteration 1 made no progress; stopping`, with fully-correct, committed code and
no PR. The agent's job per `rules.md` is to tick the criteria it has satisfied;
it verified satisfaction and skipped the tick. Any manual or prior-iteration fix
that leaves work done-but-unticked reproduces this.

## Desired behavior

When the active subspec's acceptance criteria are genuinely satisfied, the run
reaches completion (commit → PR → review/ready) rather than stalling at
no-progress — including the case where the implementation landed in a previous
iteration or an operator fix, and this iteration only confirms it.

Primary lever: harden the patch rules so "tick every acceptance criterion you
have confirmed satisfied" is a mandatory, unmissable final step, explicitly
covering work that was already complete on entry (re-verify, then tick — do not
report "already done" and stop).

## Decisions

- Tick only genuinely-satisfied criteria — never speculatively. The fix closes
  the done-but-unticked gap, it does not weaken the satisfied bar.
- Don't have the harness auto-tick arbitrary criteria; it can't judge them. The
  agent owns the tick.
- The `no-progress` stop should be more diagnostic when the agent ran clean but
  ticked nothing: name the unticked criteria and point the operator at ticking
  them if the work is in fact done, so a stall is recoverable without spelunking.

## Documentation updates

- `v1/docs/run-loop.md`: the no-progress stop, the done-but-unticked recovery,
  and any wording change to the stop message.
- `v2/docs/v1-behaviors.md`: the hardened tick-on-completion rule.

## Out of scope

- Changing how completion is measured (still checkbox transitions).
- Harness judging acceptance-criteria content/quality.
