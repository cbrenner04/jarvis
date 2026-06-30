## Verdict — required refinements

### Behavioral coverage gaps

1. **Invalid/missing `runId` guard** — Add an acceptance criterion: tail stream opened with missing or non-string `runId` closes without emitting `stream-data`. Production handler already enforces this (`daemon.ts` 376–378); the three new behavioral ACs do not pin it, so extraction could regress the branch undetected.

2. **`stream-end` abort contract** — Replace the vague abort AC with an observable outcome: after client `stream-end`, the `AbortSignal` passed to `logReader.follow` is aborted. Matches the pin already used in `ipc.test.ts` (lines 251–285) and removes implementer ambiguity about how to verify.

### API and documentation contract

3. **Pin exported symbol names** — Name `createTailStreamHandler` and `TailStreamHandlerDeps` in decisions or an AC. Harness subspecs may treat structure as contract; mirrors `createRunControlHandlers` / `RunControlHandlerDeps` precedent and removes naming variance.

4. **Doc-comment depth** — Strengthen the doc AC from mere presence to full inline standard per `v2/docs/documentation-standard.md`: purpose, params, returns, thrown errors, invariants — including deps fields and handler boundary invariants (`loadRun` before `follow`, `onClose` in `finally`, non-throwing handler). Matches completed factory specs and prevents shallow stubs.

### Sequencing and interim state

5. **Interim dual tail coverage** — Add a decision stating `ipc.test.ts` tail tests stay on inline mocks until follow-on intent `ipc-tail-stream-use-real-handler` migrates them to the real factory; cross-link that ready intent. Rationale: intentional sequencing, not oversight — but the spec must record it so implementers do not treat new factory tests as redundant with IPC tests or attempt IPC migration in this slice.

6. **`test-writing.md` deferral** — In Documentation updates, note that extending `v2/docs/test-writing.md` with a tail-stream factory example is owned by `ipc-tail-stream-use-real-handler`, not this slice.

### Cold-start implementer context

7. **Restate Prerequisites** — Add `## Prerequisites` to the subspec with intent's two gates: tail semantics shipped (`loadRun` gating, `follow` replay); run-control factory extraction precedent exists. Plan-time gates are invisible to patch agents who only read the subspec.

8. **Socket fixture guidance** — Task bullet should cite `v2/docs/test-writing.md` and `daemon-start-list.test.ts` as the socket-skip template (`canUseUnixSockets`, `test.skipIf`, hook guards). "Shared socket skip fixture" alone is under-specified.

9. **Fixture setup pointer (optional)** — Task may note durable row via injected `stateStore` and persisted events via temp `logs.jsonl` sink/reader — patterns already in `daemon-start-list.test.ts` and `ipc.test.ts`. Not mandatory; reduces fixture guesswork.

### Recorded deferrals

10. **Live-append tail** — Add decision: `Deferred to first consumer: live-append tail assertion — pin when a caller needs it` (likely IPC migration intent). Replay AC pins the durable subset; live `follow` append needs timing/blocking harness beyond extraction scope.

11. **String JSON `stream-open` payload** — Optional deferral decision; invalid-payload AC (#1) covers the guard path. No AC required unless refiner wants explicit parity note.

### Preservation ACs — no change

- Keep `ipc.test.ts` stays green — correct refactor citation per spec guidance; does not claim production-handler parity.
- Do **not** require `daemon-lifecycle.test.ts` — sibling run-control factory spec explicitly excluded it; no tail IPC path; risk is negligible. Intent's "existing daemon tests" is satisfied by the named preservation list; no refinement required unless operator wants explicit intent narrowing.

### Rationale summary

Refinements #1–#4 close verifiable gaps in handler semantics and exported contract. #5–#6 document intentional interim state so dual coverage is not misread as duplication or incomplete work. #7–#8 align with repo conventions for cold-start implementers. #10 records deferral per drafting rules — no invented precision for untested live-append behavior.

Spec scope and bounded extraction are sound; refinements are tightening, not expansion.
