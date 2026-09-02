Verifying key implementation claims before issuing the verdict.
## Verdict

**Merge posture:** The branch satisfies the spec’s grep-level acceptance criteria and core #3060 remediation (typed dispatch stubs, bounded microtask spins, zero `as unknown as AnyWorkflowStep` in the four target daemon test files, docs for the new helpers). Two operator-facing accuracy gaps and one spec-task hygiene item should be fixed before merge; everything else is acknowledged debt or harness housekeeping, not actuator blockers.

### Required outcomes

1. **`v2/docs/test-writing.md` guard scope must match enforcement.** The “Deterministic daemon and execution tests” section now allows bounded microtask spin and forbids unbounded `Promise.resolve()` loops, but the closing sentence still says `guard-deterministic-daemon-tests.ts` “verifies this rule” for the whole section. Subspec 08 explicitly deferred guard extension for microtask-spin policy. **Outcome:** prose must state that the guard enforces timer-backed sleep-as-wait (and related determinism rules the guard actually covers), and that the unbounded-microtask-spin prohibition is policy/docs-only unless and until the guard is extended. **Why:** operators and agents will otherwise assume CI blocks the #3060 hang pattern when it does not.

2. **`daemon-pipeline-recover.test.ts` `planReviewStep` comment must match the function.** The helper is now a full typed `ReviewWorkflowStep` (recovery-file pattern with `stage`, `verdictPath`, per-role `agents`, `createBinding`, etc.), but the comment still describes a “minimal” step. Subspec 06 required retyping to that pattern; the merge of the old minimal and `realPlanReviewStep` helpers is behaviorally acceptable, but the stale comment misstates what callers get. **Outcome:** the comment accurately describes the typed review-step fixture and when to use it. **Why:** maintainers relying on the comment will underestimate fixture shape and binding behavior.

3. **Retire the `okStep` identifier in `pipeline-stage-dispatch.test.ts`.** Subspec 01’s task checklist requires retiring `okStep`; the implementation replaced the cast stub with `createMinimalDispatchWriteStep()` but kept the `okStep` name. Acceptance criteria on casts and spins are met; this is the remaining literal task miss. **Outcome:** no `okStep` alias remains—call sites use `createMinimalDispatchWriteStep()` directly or a name that does not echo the retired partial stub. **Why:** the name preserves the anti-pattern’s footprint and contradicts the subspec’s explicit retirement instruction.

### Not required on this branch (acknowledged)

- **Remaining `steps[0] as unknown as { stageId | stageIndex; branchKey? }` instrumentation casts in `pipeline-execution.test.ts`:** weaker than the removed `AnyWorkflowStep` lies; outside this spec’s grep-scoped AC. Valid follow-up for broader #3060 compile-time safety.
- **`intent.md` acceptance criteria still unchecked:** inconsistent with completed `index.md`/subspecs; Jarvis/harness housekeeping, not an implementation defect.
- **`realPlanReviewStep` name / call-site split in subspec 06:** process deviation only; typed shape and green tests satisfy the behavioral bar.
- **`spinUntilMicrotask` cap, thin unit tests, duplicated `planReviewStep` across recover files, fixture field-level changes in stale-reset steps:** spec-accepted tradeoffs or required side effects of type-complete migration; assertions are the behavior proof.
- **`pipeline-stage-resolve.test.ts` and other daemon files outside the four migrated files:** out of this spec’s migration surface unless a future spec expands scope.