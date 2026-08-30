Verifying the advocate's upheld findings against the implementation and docs before issuing the verdict.
## Verdict

### Required outcomes

1. **`v2/docs/write-behavior.md` must state that committed-progress `idle_output_timeout` admits `jarvis run resume`, not that admission is still deferred.** Subspec 01 required removing interim-limbo deferral for list/wait/resume once projection landed; subspec 02 landed admission in `operator-runbook.md` and `v1-behaviors.md`. The idle-timeout paragraph still says resume admission is “governed separately by resume-admission,” which contradicts shipped behavior and leaves a ticked doc AC effectively unsatisfied.

2. **`v2/docs/operator-runbook.md` saturation bullet (~line 758) must not describe every `idle_output_timeout` as unconditionally `retryable: false` / `nextAction: "stop"` with re-dispatch-only recovery.** The 2026-08-28 gotcha was updated for resumable terminals; this older 2026-07-30 bullet was not. Operators reading both get conflicting recovery guidance for the same failure mode.

3. **`v2/docs/workflow-runner.md` should mention that committed-progress `idle_output_timeout` admits `jarvis run resume` on the retained workspace**, consistent with `v1-behaviors.md` and `operator-runbook.md`. Interim-limbo deferral is already removed and list/wait projection is documented; admission is the remaining asymmetry. Low severity, but it closes the doc surface subspec 01/02 were meant to align.

### Rationale

Core behavior for the scoped workflow path is correct and tested end-to-end: conditional operator-error mapping, list/wait projection, resume admission via `composeRunOperatorError`, and `resumeReentry` so resumable idle timeouts actually spawn a new iteration instead of idempotent echo. Pipeline settlement parity, direct-write resume parity, `intent.md` hygiene, and test-belt hardening are acknowledged gaps but out of scope or non-blocking for this spec.

The three doc outcomes above are the only material defects: they leave operator-facing prose inconsistent with implemented semantics after subspec 02, and one conflicts with a checked acceptance criterion.

### No action required on

- Production logic for workflow snapshot-backed resume (`run-operator-error.ts`, `resumeReentry`, `daemon.ts`).
- Pipeline stage settlement stop-only mapping (explicitly scoped out).
- Ad-hoc/direct-write resume parity (`reconstructDirectWriteResume` paused-only).
- Additional tests (`terminalCause`, agreement matrix for `resumable: false`, explicit branch/worktree row assertions, `@mutate` placement) unless doc fixes are the only actuator work in this pass.