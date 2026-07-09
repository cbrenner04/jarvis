## Verdict

**Upheld — require refinement:**

1. **daemon.ts wait-fanout scope gap.** The operator-runbook's own "The gate" note (the note this spec claims to resolve) frames the structural fix as deleting `FsAppendWake` *and* replacing the shared wait fanout with a per-waiter poll-only follow. `daemon.ts`'s `waitFanouts`/`ensureWaitFanout` currently share one `follow()` per run across N waiters via a single `AbortController`. The spec must either extend scope to convert this fanout to per-waiter poll-only follow, or explicitly declare the fanout structure out of scope and correct the runbook note's wording so it no longer claims something this subspec doesn't deliver. Leaving it unaddressed means a subspec that claims to resolve the note actually leaves the note's own framing unmet.

2. **CI-only claim needs CI-based evidence.** The intent claims the fix resolves intermittent timeouts on Linux CI specifically (an inotify-related leak). Ten consecutive local runs do not establish this, especially if run off Linux. Acceptance criteria must require verification against the actual CI environment (e.g., repeated `Test (v2)` runs on the PR) rather than substituting a local stress loop.

3. **Missing sweep for other `AppendWake`/`wakeFactory` callers.** `v2/docs/v1-behaviors.md` itself documents other consumers of this watcher-based seam (`daemon.ts`, `v2/src/testing/run-control.ts` / `createRunControlHandlers().close()`). The task checklist needs a step to grep/sweep for all remaining `AppendWake`/`wakeFactory` usages and update or remove them before/alongside deletion, so no dangling reference to the deleted seam survives.

4. **`v1-behaviors.md` doc update is incomplete.** The current subspec targets only one line describing `FsAppendWake`, but a second line (documenting `createRunControlHandlers().close()` "releasing its watcher deterministically") also describes watcher semantics that become stale once the watcher is deleted. The Documentation updates task must cover both lines, not just one.

**Minor addition:**

5. **Verify the directory-missing-fallback removal assumption.** The decision that polling already tolerates a not-yet-created storage file (making the fallback path removable) should be confirmed against `tail()`'s current behavior/test coverage as an explicit task step, rather than asserted without verification.

**No change needed:**

- The poll interval being specified as a named-constant range (250–500ms) rather than a single pinned number is appropriate implementer discretion per this repo's deferral convention and needs no refinement.
- The latency-change disclosure is already handled correctly (flagged as an intentional behavior change); any residual check of caller/timeout assumptions should be folded into the daemon.ts/fanout scope decision (item 1) rather than tracked separately.