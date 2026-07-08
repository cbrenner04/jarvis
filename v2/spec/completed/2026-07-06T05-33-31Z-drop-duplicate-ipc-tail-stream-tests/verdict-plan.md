## Verdict: refine before merge

Core scope is sound (delete `ipc.test.ts` tail block only; `daemon-tail-stream.test.ts` owns scenarios; transport suite stays). Six refinements are required.

### 1. Align `v2/docs/test-writing.md` (required doc edit)

**Outcome:** Subspec must require a minimal `test-writing.md` update, not “None.”

**Why:** Line 94 still claims `ipc.test.ts` exercises `createTailStreamHandler` through `startIpcServer` for allowance (a). After deletion that is false and contradicts the lean standard landed in `2026-07-06T04-37-56Z`. Operator-facing test layout belongs in `v2/docs/` per `documentation-standard.md`. The 2026-07-01 migration explicitly paired ipc tail work with a `test-writing.md` edit; reversing overlap without doc alignment reintroduces stale guidance.

**Spec must cover:** Remove the stale ipc/`createTailStreamHandler` cross-ref; name surviving round-trip owners (`daemon-tail-stream.test.ts`, `tui-log-tail-client.test.ts`). Keep general in-process-default guidance (lines 92–93) unchanged.

### 2. Add `## Prerequisites`

**Outcome:** Subspec must gate on observable dependencies the intent already states.

**Why:** Spec guidance treats prerequisites as patch-agent validation gates. The subspec omits them while intent and peer precedent (`00-migrate-ipc-tail-log-tests.md`) include them.

**Spec must cover:** Lean standards seeds landed (`2026-07-06T04-37-56Z`, `2026-07-06T04-37-57Z`). `daemon-tail-stream.test.ts` covers replay, unknown-run, and client `stream-end` abort for the three dropped ipc scenarios (plus `runId` guards not in ipc block).

### 3. Relocate PR-body requirement out of automated acceptance criteria

**Outcome:** Dropped→owner map stays in subspec body as operator contract; verification must not be an unchecked automated AC.

**Why:** Patch agents do not own PR bodies. An AC without a human-only marker blocks run completion or invites speculative ticks. Seeds (`02-v2-dead-weight-purge.md`, `03-v2-in-process-daemon-tests.md`) put test-count / dropped-test maps in **Verification**, not **Acceptance criteria**.

**Spec must cover:** Either move PR-body + baseline (`481` registrations / `544` run cases) to **Verification**, or mark the criterion `(no automated guard)`. Remove the load-bearing “no silent shrink” decision’s tie to an automated AC if relocated.

### 4. Record why 2026-07-01 overlap is retired

**Outcome:** One decision entry explaining reversal rationale, not only citing the prior spec.

**Why:** The subspec names *what* reverses but not *why* colocated ipc+tail overlap is no longer load-bearing. Without it, implementers may re-litigate wire-path uniqueness.

**Spec must cover:** Lean standard (in-process default, capped socket budget) + scenario-level duplication in `daemon-tail-stream.test.ts` — rules out keeping colocated ipc+tail integration for wire-path coverage alone.

### 5. Cite pinning tests for preservation AC

**Outcome:** Replace paraphrased transport-preservation AC with a test anchor per spec guidance for refactor slices.

**Why:** “Transport-suite tests stay green” restates assumed behavior; citing the suite forces verification against the tree.

**Spec must cover:** `ipc.test.ts` transport `socketTest` registrations (lines 63–156: `health RPC round-trips` through `server stays up after a malformed client disconnects`) stay green.

### 6. Tighten file-header comment task scope

**Outcome:** Tasks must require rewriting lines 14–19, not a conditional tail-only header tweak.

**Why:** Those lines assert this file exercises real `openLogReader`/`follow()` “below”; the entire block becomes false after tail deletion, not only a `// Tail-log stream tests` marker.

**Spec must cover:** Remove `openLogReader`/`follow()` tail rationale; retain sandbox-unrunnable judgment pointing at `daemon.sandbox-unrunnable.test.ts`.

### Optional (non-blocking)

- **Seed 02 ordering:** One line that merged implementation should drop the duplicate ipc tail item from `02-v2-dead-weight-purge.md` — rules out double-landing the same deletion.
- **Line range:** Align `~158–323` if touched (cosmetic).

### Defended (no spec change)

- No automated “exactly −3 registrations” AC; structural AC + baseline in Verification/PR body is sufficient.
- Scenario-level superset in `daemon-tail-stream.test.ts` is adequate; per-test `withTailServer` override is test lifecycle, not unique production coverage (`tui-log-tail-client.test.ts` retains wire smoke).
- `test:integration:v2` as broad gate matches repo convention for v2 slices.
