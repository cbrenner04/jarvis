## Verdict: refinements required before merge

### 1. Export contract must cover hook guards, not only `skipIfNoSockets`

All three consumers read a module-scope availability flag in `beforeEach`/`afterEach`. Tasks and a structural AC name only `skipIfNoSockets`, so an implementer could export the wrapper alone and break hooks while satisfying the letter of the spec.

**Required:** Tasks and a structural AC must require exporting the settled Unix-socket availability signal (same role as today’s `canCreateSockets`) alongside `skipIfNoSockets`.

---

### 2. Per-file stderr preservation needs an explicit ownership rule

Two consumers emit distinct stderr on probe failure (`ipc.test.ts` vs `daemon.sandbox-unrunnable.test.ts`); the third emits none. The decision forbids homogenizing messages but not where stderr lives. A shared probe that writes on failure would collapse messages to import order. “Stays green” does not assert stderr text.

**Required:** Add a decision that stderr skip messages stay caller-owned (file-local emission or per-caller hook); the shared fixture supplies settled availability only.

---

### 3. Sequencing with `v2-socket-tests-skip-honestly` must be recorded

A downstream intent depends on this spec for the shared probe and mandates `test.skipIf`, forbidding silent early-return skips. This spec explicitly rules out `test.skipIf` migration — intentional, not a fork.

**Required:** One decision line deferring `test.skipIf` adoption and silent-pass doc reversal to `v2-socket-tests-skip-honestly`; this spec documents fixture location and import guidance only.

---

### 4. Inline doc-comments are in scope per `documentation-standard.md`

`v2/docs/documentation-standard.md` requires doc-comments on every exported symbol. Documentation updates cover only `test-writing.md`.

**Required:** Task and AC requiring doc-comments on every exported fixture symbol per the documentation standard.

---

### 5. Restore prerequisite tying doc guidance to existing conventions

Intent declares a prerequisite: `test-writing.md` already distinguishes agent-runnable from sandbox-unrunnable tests. That gates “when to import” without dictating skip mechanism. The subspec omits `## Prerequisites`.

**Required:** Restore `## Prerequisites` (one line) or fold the same gate into the doc task so fixture guidance aligns with existing test-class conventions.

---

### Not required (defended)

- Probe evaluation timing deferral — “stays green” on three consumers pins observable behavior.
- Dedicated probe unit test — extraction pinned by integration consumers.
- Module filename pin — `v2/src/testing/` is sufficient for this slice.
- Normalizing `ipc.test.ts` vs `v2/src/ipc/ipc.test.ts` in behavioral ACs — cosmetic.
- Optional `false` init / timeout pattern note — implementation detail unless a consumer needs it.
- Optional doc sentence on silent-return until skip-honestly lands — useful debt callout, not merge-blocking given explicit sequencing decision above.
