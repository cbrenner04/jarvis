## Verdict: required refinements before merge

### Acceptance criteria

1. **Production wiring must be verifiable.** Add an AC that `startDaemon` supplies a failure reporter that appends `run_execution_failed` through the real log sink (integration-style or thin dep injection). The task checklist already requires this; factory precedent (`startDaemon` registers factory-produced handlers) treats wiring as completion, not optional.

2. **Documentation updates need checkboxes.** Per `v2/docs/documentation-standard.md` and repo precedent, each named durable home (`v2/docs/v2-architecture.md`, `v2/docs/daemon-host.md`) and inline contract on changed exported symbols (`RunControlHandlerDeps`, `createRunControlHandlers`) must have literal-token ACs. `daemon-host.md` must cover post-failure operator shape (`status: "failed"`, `isLive: false`) in the `list` table or an explicit cross-link — prose-only updates drift from the transport contract.

3. **Existing factory tests need a preservation AC.** `daemon-start-list.test.ts` stays green (updated for required `failureReporter` noop as needed). Invasive deps change without this risks silent regression; spec-guidance refactor pattern requires citing the pinning test.

4. **Terminal-status guard needs an AC.** When durable status is already terminal (`completed`, `blocked`, `killed`, `paused`, `failed`), spawn-boundary capture must not overwrite it. Covers post-settlement wrapper failures (e.g. `logSink.close()` throw after normal loop return) and hypothetical `kill`/`capture` races.

5. **Attempt skew should be observable.** After executor rejection capture, durable run is `failed` even if the latest attempt remains `in-progress` — documents accepted non-reconciliation without `commitCompletionBoundary` in this slice.

### Decisions ledger (add or sharpen)

6. **Injectable `failureReporter` contract.** Pin on `RunControlHandlerDeps`: required `(runId, reason: unknown) => void | Promise<void>`; tests pass noop; task checklist notes migration for existing factory consumers.

7. **Await reporter before ownership release.** Spawn boundary awaits the failure reporter (sync or async) before `finally` cleanup — rules out fire-and-forget races against ownership-release ACs.

8. **Production reporter opens its own sink.** `startDaemon`'s failure reporter opens the log sink via `logsPath` when the executor failed before sink creation — rules out requiring a pre-opened sink from the executor wrapper.

9. **No attempt reconciliation.** Spawn-boundary capture does not call `commitCompletionBoundary` — rules out repairing attempt state on harness faults.

10. **No terminal-status overwrite.** Capture skips `setRunStatus("failed")` when durable status is already terminal — rules out clobbering normal settlement or operator `kill`.

11. **`setRunStatus` failure posture.** State persist is best-effort on rejection: `finally` still releases ownership; no recovery when persist throws (aligned with dual-outage out-of-scope). No separate AC required if stated.

12. **`start` and `resume` share capture path.** Both entry points use the same spawn-boundary capture — rules out resume-only gap without a distinct resume AC.

13. **Error preservation scope.** Original rejection forwarded to the injected reporter only; spawn boundary does not rethrow to RPC callers or add daemon stderr — rules out duplicating diagnostics outside the reporter contract (RPC non-throwing invariant preserved).

14. **Deferred to first consumer: `wait` on `run_execution_failed`.** Pin in `daemon-wait-run-completion` when that consumer exists — parallel terminal signal without `loop_finished`.

### Task checklist / test placement

15. **Pin test file.** Name `daemon-run-failure-capture.test.ts` (new) or explicit extension of `daemon-start-list.test.ts`; either acceptable if preservation AC covers the other file.

### Rationale (why these matter)

Intent requires durable `failed` state, one log event, ownership release, and preserved error — not orphaned in-progress runs or vanished exceptions. Current ACs exercise only injected factory fakes; production wiring and docs are unenforceable without the gaps above. Spawn-boundary capture for executor rejections only is correct, but without terminal-status guard and attempt non-reconciliation decisions, implementers could clobber settled runs or invent boundary repair. Reporter contract + await semantics close race holes the ownership-release ACs assume.

### Not required

- Prerequisite echo in the subspec (plan gate already validated).
- Minimum `run_execution_failed` payload beyond `kind` (correctly deferred).
- Splitting into multiple subspecs (scope is atomic).
- Distinct resume AC if decision #12 is added.
- Non-`Error` rejection normalization AC (opaque forward is sufficient if decision #13 is added).
