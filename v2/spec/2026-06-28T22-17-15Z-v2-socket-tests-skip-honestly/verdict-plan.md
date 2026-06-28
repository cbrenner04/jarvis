## Verdict — required refinements

### 1. Registration-time vs invocation-time skip semantics

Record an explicit decision that migrating to `test.skipIf` fixes skip gating at test registration (post-settle probe value), accepting the late-`listening` false-skip tradeoff that invocation-time `skipIfNoSockets` previously avoided.

**Why:** Intent is honest Bun skip reporting; that mechanism cannot preserve invocation-time gating without a different skip path. Omitting the tradeoff leaves a silent behavior regression against the prior shared-fixture contract.

### 2. Behavioral acceptance criterion for skip-not-pass

Add an AC that pins the intent outcome — unavailable sockets must report skipped, not pass — not only API renames and `test.skipIf` call shape.

**Why:** Structural ACs alone allow inverted `test.skipIf` polarity or a no-op migration while `bun run test` stays green in socket-capable CI. The spec title and intent promise observable skip semantics.

### 3. Doc-comment acceptance criterion

Add an AC that `v2/src/testing/unix-socket.ts` exported symbols (`canUseUnixSockets`, `socketProbeErrored`) have doc-comments per `v2/docs/documentation-standard.md`.

**Why:** Tasks and Documentation updates already require it; without a checkbox, doc alignment is unverifiable at completion (same gap the shared-fixture subspec closed).

### 4. `canUseUnixSockets()` read-semantics contract

Require the accessor doc-comment (and/or fixture AC) to state: value read at call time; `test.skipIf` captures availability at registration; post-settle false→true does not un-skip already-registered tests; hook guards may observe a later flip.

**Why:** Renaming `canCreateSockets` without read semantics leaves hook-guard vs `test.skipIf` behavior ambiguous for a competent implementer.

### 5. Hook-guard migration in consumer AC

Extend the three-file consumer AC to forbid `canCreateSockets` import/usage and require hook guards to use `canUseUnixSockets()`.

**Why:** Tasks already require hook migration; ACs currently only ban `skipIfNoSockets`, so stale `canCreateSockets` in `beforeEach`/`afterEach` could satisfy letter-of-spec.

### 6. `socketProbeErrored` stderr preservation

Add a preservation AC (refactor style: cite pinning files) that file-local stderr gated on `socketProbeErrored` in `ipc.test.ts` and `daemon.sandbox-unrunnable.test.ts` remains unchanged; `daemon-start-list.test.ts` stays silent on skip.

**Why:** An explicit decision preserves this behavior, but no AC pins it; a doc rewrite could drop operator context without failing completion.

### 7. `test-writing.md` update scope

Task/Documentation updates must change skip mechanism to `test.skipIf` and forbid silent-return wrappers while preserving existing hook-guard and probe-error stderr guidance in the shared socket fixtures section.

**Why:** Current section bundles three policies; a skip-only edit risks dropping hook/stderr guidance without failing any AC.

---

### Not required

- **`describe.skipIf` / nested `describe` coverage** — socket-dependent registrations are `test(...)`; current scope language is sufficient.
- **Mandatory no-socket-environment CI proof** — acceptable to defer if refinement #2 adds a structural or behavioral guard; optional human-only sandbox verify only if automation is judged infeasible in-scope.
- **Worked `test.skipIf` call-shape example in Tasks** — clarity improvement only; not blocking.
- **`v2/docs/v1-behaviors.md`** — test-harness semantics only; correctly omitted.
