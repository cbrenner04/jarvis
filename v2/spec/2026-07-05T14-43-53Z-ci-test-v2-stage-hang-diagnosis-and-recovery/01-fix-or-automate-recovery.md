# Fix or automate recovery for the `Test (v2)` hang

## Problem

Subspec 00 classifies the hang's root cause. This subspec closes it out:
either fix the jarvis-side hang directly, or automate the operator's manual
`gh run cancel <id>` + `gh run rerun <id> --failed` recovery. Which branch
applies is contingent on subspec 00's finding — do only the applicable one.

## Decisions

- Exactly one of the two task-checklist branches below applies; skip the
  other. Do not implement both.
- No existing code detects a stuck run or auto cancel/reruns
  (`v1/src/commands/triage.ts`'s `waitForCiGreen` only tracks overall
  elapsed time against a single timeout) — the automation branch is new
  functionality, not an extension of a partial existing mechanism.
- Deferred to subspec 00's finding: exact detection threshold/mechanism for
  a stuck step (e.g. zero log growth for N minutes), if the automation
  branch is taken.

## Task checklist

- [ ] **If jarvis-side:** bound the identified unbounded operation with a
      timeout (matching the existing shrink-phase git subprocess bound
      pattern in `v2/docs/v1-behaviors.md`) so the affected test/run fails
      fast instead of hanging.
- [ ] **If GitHub-runner-side:** add stuck-run detection to the CI-poll flow
      (`waitForCiGreen` in `v1/src/commands/triage.ts` or an equivalent
      call site) that detects a `Test (...)` step with no log/status
      progress past a threshold and automatically cancels and reruns the
      run.

## Acceptance criteria

- [ ] If jarvis-side: the previously-hanging operation now fails fast under
      a bounded timeout instead of hanging (demonstrated by a test covering
      the timeout path).
- [ ] If GitHub-runner-side: a stuck `Test (...)` step is detected and
      cancel+rerun happens automatically, without operator intervention.
- [ ] `v1/docs/operator-runbook.md`'s CI section reflects the landed fix or
      automation, replacing the manual cancel/rerun guidance.

## Documentation updates

- Update `v1/docs/operator-runbook.md`'s CI/gate section to describe the
  landed fix or automated recovery, replacing the manual-recovery note.
