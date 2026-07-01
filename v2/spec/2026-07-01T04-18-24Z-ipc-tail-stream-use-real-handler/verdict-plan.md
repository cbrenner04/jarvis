## Verdict — required refinements

### 1. Add `## Prerequisites` with factory-spec sequencing context
Subspec must echo intent gates: exported `createTailStreamHandler`, `test-writing.md` run-control factory-over-fakes example. Cross-link completed factory spec (`2026-06-29T21-46-33Z-daemon-tail-stream-handler-factory`) as the work this slice finishes (deferred `ipc.test.ts` migration + tail `test-writing.md` example). Patch agents reading only the subspec need an explicit validation gate; peer factory spec sets the precedent.

### 2. Pin `daemon-tail-stream.test.ts` as the fixture template
Tasks must direct implementers to copy lifecycle and fixture patterns from `daemon-tail-stream.test.ts` — temp state DB, `stateStore.createRun` seeding, `stateStore.close()`, `seedRun`/`createRunWithLogs`, orphan-log unknown-run setup, `follow` wrapper spy — not from current `ipc.test.ts` tail section. Task list names `openStateStore` but omits per-test DB lifecycle; that must be covered.

### 3. Strengthen unknown-run acceptance criterion
Unknown-run AC must require orphan persisted events (logs exist, no `loadRun` row) **and** assert `logReader.follow` is not invoked. `stream-end` without `stream-data` alone passes a handler that calls `follow` then filters; production gate and `daemon-tail-stream.test.ts` pin non-invocation. Task/decision already imply orphan logs; AC must match or the contract is weaker than stated intent.

### 4. Make abort-coverage spy required, not optional
Abort AC requires observing `AbortSignal` abort on `logReader.follow`. Real handler exposes that only via injected `follow` wrapper (`onFollow` pattern in `daemon-tail-stream.test.ts`). Task “optional” spy contradicts the AC; drop optional wording and rule out the inline `followAborted` capture pattern (incompatible with real factory).

### 5. Add load-bearing decisions the draft omits

- **Fixture semantic upgrade, not preservation** — replay/unknown-run fixtures must gain durable-row / orphan-log shapes matching production `loadRun` gating; current `ipc.test.ts` replay test is false-green against real handler (logs only, no row). Rules out characterizing the slice as behavior-preserving refactor.
- **Post-migration suite overlap** — `daemon-tail-stream.test.ts` keeps handler guard matrix; `ipc.test.ts` keeps colocated IPC+tail integration. Rules out deleting IPC tail tests or merging suites as “duplicate.”
- **Per-test isolated tail servers** — preserve existing per-test `tailServer` override of suite default server; add `stateStore` per test. Rules out shared `beforeEach` hook coupling tail lifecycle to RPC suite setup.
- **Invalid-payload guards out of scope** — missing/non-string `runId` covered in daemon suite only. Rules out expanding IPC tail section to full guard matrix.
- **No `v1-behaviors.md` update** — test-only slice; production tail semantics unchanged. Rules out spec-guidance behavior-change doc churn.

### 6. Clarify `ipc.test.ts stays green` AC role
Retain as implementation gate only; do not imply unchanged wire semantics. Behavioral contract lives in the strengthened behavioral ACs above.

### Rationale (cross-cutting)
Intent and landed factory work define this as completing deferred IPC migration to the real handler with corrected fixtures/assertions. Gaps leave implementers without prerequisite gates, fixture source, or AC strength to catch reintroduced inline-handler drift — the exact failure mode the intent targets. Doc home (`v2/docs/test-writing.md`) and harness structural ACs are adequate; no further doc-precision refinement required.
