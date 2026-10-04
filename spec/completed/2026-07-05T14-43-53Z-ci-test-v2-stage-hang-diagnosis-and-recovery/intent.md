---
name: ci-test-v2-stage-hang-diagnosis-and-recovery
---
# Diagnose intermittent CI `Test (v2)` hangs and land a fix or recovery

## Problem

`Test (v2)` within CI's `checks` job intermittently hangs with zero step
progress for 15-20+ minutes on GitHub-hosted runners; identical runs
otherwise complete in under a minute. Not reproducible locally. Manual
`gh run cancel` + `gh run rerun --failed` recovers reliably. Root cause
unknown: could be a real hang in jarvis's own v2 test scope, or a
GitHub-runner-side flake.

## Decisions

- Root cause and fix are contingent on each other: whether the fix is a
  code change (jarvis-side hang) or operator-facing automation (stuck-step
  detection + auto cancel/rerun) is not decidable before diagnosis, so both
  stay in one intent rather than being pre-split.
- Deferred to diagnosis: exact detection threshold/mechanism for a stuck
  step, if the automated-recovery branch is taken — pin once the
  investigation confirms GitHub-runner-side flakiness.

## Prerequisites

## Task checklist

- [ ] Determine whether the hang is isolated to `Test (v2)`/`Test (v2 integration)`
      or also occurs on `test:v1`/`test:shared` scoped steps.
- [ ] Check GitHub Actions status-page/incident history correlation vs. a
      real hang in jarvis's own v2 test suite (unbounded spawn, socket wait).
- [ ] If root-caused to jarvis: fix the underlying hang.
- [ ] If GitHub-runner-side: automate stuck-step detection (zero log growth
      past a threshold) and cancel+rerun recovery.

## Acceptance criteria

- [ ] Root cause identified and documented, or the automated recovery lands.
- [ ] No behavior change to specs/PRs unaffected by this stall pattern.

## Documentation updates

- Update `v1/docs/operator-runbook.md`'s CI/gate section once a fix or
  automated recovery lands.
