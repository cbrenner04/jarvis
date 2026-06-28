## Verdict: refinements required before merge

### 1. Restore runtime skip gating in `skipIfNoSockets`

**Outcome:** `skipIfNoSockets` must decide whether to run the test body at **test invocation time**, not when the wrapper is created at module load.

**Why:** The spec requires behavior unchanged by extraction and preserved skip semantics. The current implementation binds availability when `skipIfNoSockets(...)` is called (after the probe settles). The pre-extraction pattern re-checked `canCreateSockets` inside the returned async function. That difference matters when the probe’s 100ms timeout resolves before a late `listening` event: the old code could still run tests; the new code will not. Green CI does not disprove this — it is environment-dependent.

---

### 2. Restore pre-extraction stderr emission conditions

**Outcome:** `ipc.test.ts` and `daemon.sandbox-unrunnable.test.ts` must emit their distinct skip messages only under the same conditions as before extraction (probe `error`), not merely whenever `canCreateSockets` is false after the probe settles. `daemon-start-list.test.ts` must remain silent on skip (unchanged).

**Why:** The spec’s caller-owned stderr decision governs **who** writes messages, not **when**. Before extraction, timeout-without-error left sockets unavailable but produced no stderr; the migrated `if (!canCreateSockets)` blocks now stderr on that path too. That is observable behavior drift against “unchanged by extraction,” independent of whether messages stay file-local.

---

### 3. Bring export doc-comments up to the documentation standard

**Outcome:** Every exported symbol in the shared socket fixture must document purpose, parameters, returns, and relevant invariants per `v2/docs/documentation-standard.md`. At minimum:

- `canCreateSockets`: probe-complete availability signal; consumers must not re-probe; note that post-probe mutation is probe-internal only.
- `skipIfNoSockets`: `@param` / `@returns`; state explicitly that gating happens at test invocation time (once §1 is fixed).

**Why:** Acceptance criteria require doc-comments per the documentation standard, not one-line placeholders. `bindings.ts` in the same directory sets the bar; current fixture comments do not meet the stated contract fields.

---

### Not required for merge

- **Probe resource leak on timeout/error** — pre-existed in all three copies; extraction scope was deduplication, not probe hardening.
- **`test-writing.md` stderr catalog** — spec task satisfied; per-suite stderr inventory is optional polish, not AC.
- **Import `.ts` suffix in `daemon.sandbox-unrunnable.test.ts`** — cosmetic inconsistency; fix if convenient, not merge-blocking.
- **`test.skipIf` / naming alignment with `v2-socket-tests-skip-honestly`** — intentionally deferred by spec.
- **Pre-existing misuse** (e.g. non-socket tests wrapped in `skipIfNoSockets`) — out of scope for this slice.
