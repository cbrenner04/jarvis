## Verdict — required refinements

### 1. Remove stale preservation AC for deleted test file

The acceptance criterion citing `v2/src/persistence/log-stream.sandbox-unrunnable.test.ts` must be dropped. That file no longer exists; `log-stream.test.ts` (lines 57–64) documents the deletion and pins wake/replay behavior via injectable `AppendWake`. A preservation AC for a missing file is unverifiable and violates spec-guidance refactor pinning (cite an existing test, not assumed behavior).

**Outcome:** Log-stream behavior preservation is anchored only on `v2/src/persistence/log-stream.test.ts`.

---

### 2. Add `## Prerequisites` mirroring intent

Intent declares seed 01 (`v2/docs/documentation-standard.md` lean tiering + `v2/docs/test-writing.md` in-process defaults landed). The subspec omits `## Prerequisites`. Plan-mode treats prerequisites as validation gates, not intent-only context; resume/draft must be able to confirm the foundation before implementation.

**Outcome:** Subspec includes a `## Prerequisites` section equivalent to the intent’s seed-01 gate.

---

### 3. Record seed 02 partial fulfillment and post-merge seed trim

Seed 02 (`v2/spec/seeds/02-v2-dead-weight-purge.md`) lists the same six symbols (`RequestFrame`, `StreamOpenFrame`, `FrameDecoder.reset()`, `IterationStartedEvent`, `BoundaryCommittedEvent`, `AppendWakeFactory`). This spec closes a fan-out gap (no matching ready-intent exists), but without an explicit decision a future seed-02 run could duplicate this work.

**Outcome:** Decisions must state this spec fulfills only seed 02’s ipc/log-stream de-export/delete entries — not full seed 02. Include a post-merge action (task or note) to remove those six symbols from seed 02’s de-export/delete list.

---

### 4. (Optional, not blocking) Compile-time narrowing pin

Existing decisions already pin file-local de-exports and unchanged exported entry points (`IpcFrame`, `LogEvent`, `openLogReader`, `AppendWake`). If reviewers treat de-export as semver-breaking, add one decision: compile-time narrowing is intentional for zero-importer symbols; runtime/wire shapes unchanged. Omit if structural ACs suffice for review.

---

### Upheld as non-issues (no refinement)

- **`reset()` preservation AC:** Dead-code deletion with zero call sites; structural AC (`FrameDecoder` has no `reset` method) is correct. `ipc.test.ts` covers codec paths that never invoked `reset()`.
- **Formal preflight audit AC:** Symbol list matches current import graph; `bun run typecheck` catches missed external references. Out-of-scope already forbids broader sweeps.
- **Durable doc updates:** Correctly none — internal visibility trim, no operator-facing behavior change.
- **Redundant task/AC pairs, tier-evident comments on de-exported types, `v2-architecture.md` drift:** Cosmetic or out-of-scope; not blocking.
