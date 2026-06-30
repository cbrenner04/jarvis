## Verdict: required refinements

### Blockers — concurrency and abandonment

1. **`00` must pin concurrent RPC on one connection.** `daemon-host.md` requires `list` (and other RPCs) to complete while `wait` is pending on the same socket. The scaffold client rejects non-correlated replies; that contract must be revised in `00` with a decision and acceptance criterion that `list()` succeeds while `wait(runId)` is unresolved (injectable fake + socket-backed case).

2. **`00` and `01` must pin stale-`wait` suppression.** Selection change abandons the prior `wait` client-side only (no server cancel, no disconnect). Both subspecs need an explicit contract: late responses from abandoned waits are ignored (by request `id` and/or selected `runId`). `01` needs an AC where a fixture emits a late abandoned-`wait` response and the outcome panel stays on the newly selected run.

3. **`01` must close the selection-mechanism gap.** "Deferred to first consumer: UX beyond default-first-row" leaves production navigation unpinned while behavior ACs assume selection changes. Either pin minimum operator navigation (e.g. row up/down) with ACs, or state explicitly that selection-change ACs are verified through the injectable view-host seam until keybindings land.

### Blockers — lifecycle and list/wait invariants

4. **`01` must record long-lived connection lifecycle.** One open client from post-connect proof until operator quit; `close()` on exit. Rules out scaffold one-shot `finally` close after liveness proof.

5. **`01` must pin empty-list and initial-selection behavior.** Non-empty list: first row selected (daemon `created_at DESC` / newest-first) and `wait` issued on entry. Empty list: no selection, no `wait`, explicit empty state. Rules out implicit undefined behavior for both paths.

6. **`01` must pin selection across list refresh.** When polled `list` adds or removes runs, selection sticks by `runId`; if the selected run vanishes, clear selection and abandon any pending `wait`. One AC or decision.

### Blockers — spec-guidance and docs

7. **`01` must cite `tui-entry.test.tsx` as a preservation anchor.** Replacing one-shot connect exit with an interactive monitor is a behavior change; `cli.test.ts` green does not pin TUI entry. AC must cite `v2/src/tui-entry.test.tsx` (updated for interactive monitor), not paraphrase scaffold behavior.

8. **`01` documentation AC must include `write-behavior.md` Verification section.** Doc ACs cover the TUI table but not Verification bullets that still reference scaffold-only `tui-entry.test.tsx` scope. Extend doc AC to update Verification alongside the TUI CLI section.

### Required clarifications (non-blocking alone, needed for operator truth)

9. **`01` must state monitor replaces connect-only proof UX.** After `health` + `status` proof, enter the run monitor (not indefinite dual scaffold + monitor chrome).

10. **`01` docs must separate list `status` from outcome `runStatus`.** List rows use daemon `list` fields at poll time; outcome panel uses `wait` fields at resolve time — no cross-inference. Outcome is an invocation-boundary snapshot from `wait`, not "terminal only" and not inferred from list polls.

11. **`00` should record `wait` params `{ runId }` and optional type reuse.** Wire shape in decision/task; reuse `WaitRunCompletionResult` from `daemon.ts` (same as CLI) — rules out paramless `wait` and a parallel TUI-only alias.

### Deferred / out of scope for this refine pass

- Mid-session `list`/`wait` transport and RPC error UX beyond unavailable-at-entry (sticky last-good list vs inline error) — valid follow-on; not required to unblock core monitor if refresh failure behavior is at least named as deferred.
- Socket-backed ink E2E monitor — split across `00` RPC proofs and `01` injectable view fakes is acceptable.
- Numeric poll interval — correctly deferred; docs describe periodic refresh without pinning ms.
- `daemon-host.md` edit — not required; wire contract already authoritative.
- Phase 4 build-order traceability note — optional index/`01` one-liner.

### Rationale

Items 1–2 are load-bearing: without them `01` cannot run periodic `list` and pending `wait` on one connection, and selection change can corrupt the outcome panel. Items 3–6 pin observable operator/runtime behavior the current ACs assume but do not state. Items 7–8 are spec-guidance compliance for a behavior-preserving refactor surface. Items 9–11 prevent doc/UX contradictions with `daemon-host.md` and intent scope (observe-only, daemon-sourced outcome).
