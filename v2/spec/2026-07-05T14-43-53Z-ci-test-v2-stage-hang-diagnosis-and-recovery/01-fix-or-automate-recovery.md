# Fix or automate recovery for the `Test (v2)` hang

## Problem

Subspec 00 classifies the hang's root cause. This subspec closes it out:
either fix the jarvis-side hang directly, or automate the operator's manual
`gh run cancel <id>` + `gh run rerun <id> --failed` recovery. Which branch
applies is contingent on subspec 00's finding — do only the applicable one.
An inconclusive finding also routes to the automation branch (subspec 00's
decisions).

## Decisions

- Exactly one of the two task-checklist branches below applies; skip the
  other. Do not implement both. An inconclusive subspec-00 finding counts as
  GitHub-runner-side for this purpose (automation branch applies).
- No existing code detects a stuck run or auto cancel/reruns
  (`v1/src/commands/triage.ts`'s `waitForCiGreen` only tracks overall
  elapsed time against a single timeout) — the automation branch is new
  functionality, not an extension of a partial existing mechanism.
- Deferred to subspec 00's finding: exact detection threshold/mechanism for
  a stuck step (e.g. zero log growth for N minutes), if the automation
  branch is taken.
- Deferred to implementation: exact call site for stuck-detection (e.g.
  `waitForCiGreen` in `v1/src/commands/triage.ts`, or an equivalent) — pin
  when the automation branch is taken.
- If subspec 00 finds the hang also occurs on `test:v1`/`test:shared`-scoped
  steps, the jarvis-side fix (if that branch applies) covers those steps
  too, not just `Test (v2)` — scope follows subspec 00's finding, not the
  intent's original v2-only framing.

## Task checklist

- [ ] **If jarvis-side:** bound the identified unbounded operation with a
      timeout so the affected test/run fails fast instead of hanging. If
      the operation is a subprocess call, the existing shrink-phase git
      subprocess bound pattern (`v2/docs/v1-behaviors.md`) is a reference
      example; sockets/timers need their own bound, not that pattern.
- [ ] **If GitHub-runner-side or inconclusive:** add stuck-run detection to
      the CI-poll flow that detects a `Test (...)` step with no log/status
      progress past a threshold and automatically cancels and reruns the
      run.

## Acceptance criteria

- [ ] If jarvis-side: the previously-hanging operation now fails fast under
      a bounded timeout instead of hanging (demonstrated by a test covering
      the timeout path).
- [ ] If GitHub-runner-side or inconclusive: a stuck `Test (...)` step is
      detected and cancel+rerun happens automatically, without operator
      intervention.
- [ ] If GitHub-runner-side or inconclusive: a run whose steps are slow but
      still progressing is not cancelled (demonstrated by a test covering
      the non-stuck path).
- [ ] `v1/docs/operator-runbook.md`'s CI section reflects the landed fix or
      automation, replacing the manual cancel/rerun guidance.

## Documentation updates

- Update `v1/docs/operator-runbook.md`'s CI/gate section to describe the
  landed fix or automated recovery, replacing the manual-recovery note.
