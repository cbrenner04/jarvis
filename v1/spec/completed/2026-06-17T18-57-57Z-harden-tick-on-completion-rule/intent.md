---
name: harden-tick-on-completion-rule
---
# Patch rules force ticking already-satisfied criteria

**Scope.** `prompts/patch/rules.md`, docs.

## Problem

An iteration that finds the active subspec's work already done on entry
(prior-iteration or operator fix) re-verifies it, reports "already done", and
stops without ticking. Because progress is gauged by checkbox transitions, the
run exits `no-progress` (code 4) with correct, committed code and no PR.

## Desired behavior

The patch rules make "tick every acceptance criterion you have confirmed
satisfied" a mandatory final step, explicitly covering work already complete on
entry: re-verify, then tick — never report "already done" and stop. Ticking
stays restricted to genuinely-satisfied criteria; the satisfied bar is not
weakened and the harness does not auto-tick.

## Decisions

- Agent owns the tick; harness never auto-ticks (it cannot judge criteria).
- Already-done-on-entry path is called out explicitly, since that is the case
  the current wording lets slip.

## Documentation updates

- `v2/docs/v1-behaviors.md`: the hardened tick-on-completion rule (re-verify and
  tick already-satisfied criteria).

## Out of scope

- Changing how completion is measured (still checkbox transitions).
- Harness judging acceptance-criteria content/quality.

## Prerequisites
