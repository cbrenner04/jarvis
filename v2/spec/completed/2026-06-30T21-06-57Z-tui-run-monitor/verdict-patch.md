## Verdict: required outcomes

### 1. Post-connect failures must not use unavailable-daemon feedback

After a successful connect and `health`/`status` proof, transport or malformed-payload failures from `list` or `wait` must not present the unreachable-socket copy (`~/.jarvis/daemon.sock` / `jarvis daemon start`). That messaging is scoped to connect-time unreachability per `01`; `TuiDaemonConnectionError` also covers protocol and payload errors that imply a running daemon.

**Outcome:** Entry error handling distinguishes unreachable-at-connect from post-liveness-proof failures, with operator feedback that matches the failure class. A co-located test covers initial `list` (or equivalent post-proof RPC) failure after successful `health`/`status`.

**Rationale:** Wrong remediation misleads operators and contradicts the pinned unavailable path in `01`.

---

### 2. List refresh must preserve selection against concurrent selection changes

When a periodic `list` completes, the “selected run vanished” check must use the selection in effect at completion time, not a snapshot taken before the async `list` call. If selection changed while refresh was in flight, a vanished *old* id must not clear a valid *new* selection.

**Outcome:** Selection-by-`runId` across refresh holds under overlap with selection change, per `01`. A co-located test covers refresh completing after a concurrent selection change.

**Rationale:** Violates the explicit “preserve selection by `runId`” contract when the stale id disappears but the current id remains.

---

### 3. Same-selection `wait` failure must not leave a permanent pending outcome

Mid-session error UX for list/wait remains deferred in `01`, but an unresolved `wait` that has already failed with unchanged selection must not keep showing a pending outcome indefinitely.

**Outcome:** On `wait` failure with the same selected `runId`, the outcome panel reverts to the last ready snapshot or shows an explicit error state—not perpetual “Waiting for …”. Behavior aligns with `write-behavior.md` (“keep the last good monitor snapshot” on mid-session failure).

**Rationale:** Silent catch with `waitState` stuck at `pending` is misleading operator state, worse than the deferred “sticky snapshot vs inline error” choice.

---

### 4. Operator docs must match shipped behavior

`write-behavior.md` currently contradicts itself: the exit table implies guard/RPC failure always exits `1`, while the body describes mid-session refresh/`wait` failures keeping the last-good snapshot and exiting `0` on quit. The TUI section also describes selection-change semantics without stating that production ink has no row-navigation keys yet (first row only; selection changes via the injectable view-host seam per `01` deferral).

**Outcome:** Reconcile the exit table with entry-time vs mid-session failure semantics. Add a concise note that production row selection is first-row-only until navigation keybindings land.

**Rationale:** `01` documentation ACs require accurate operator-facing semantics; current text overstates interactivity and misstates exit behavior.

---

### 5. Quit input must not re-register on every refresh rerender

Production ink registers `useInput` inside a component that is recreated on each `rerender` (~1 Hz). Input handling must remain stable for the monitor session lifetime.

**Outcome:** Quit (`q` / Ctrl-C) input is bound once per monitor session, not re-bound on each list-driven rerender.

**Rationale:** Re-registration risks duplicate handlers and violates ink hook expectations; quit is a pinned `01` AC.

---

### 6. Deduplicate ink feedback and align stale client doc-comments

`showTuiInkFeedback` is duplicated in `tui-entry.tsx` and `tui-ink-feedback.tsx`. Exported type comments on `TuiDaemonClient` and `TuiDaemonRpcError` still describe only `health`/`status` despite `list`/`wait` and broader RPC error scope.

**Outcome:** Entry imports the shared feedback helper (single source). Stale exported-type doc-comments reflect the full client surface and RPC error scope per `00` inline-documentation intent.

**Rationale:** Prevents drift between entry and feedback modules; doc-comments must not contradict implemented API.

---

### Not required for this pass

- Production row-navigation keybindings (explicitly deferred; view-host seam covers selection ACs).
- Default 1s refresh interval (deferred value pinned at first consumer; scheduler remains injectable).
- Silent transition from liveness proof into monitor (per `01` decision).
- Server-side `wait` cancel on row removal (client-side abandonment via token/`runId` satisfies `01`).
- `waitUntilExit` never resolving in production ink (quit path works; seam smell only).
- Negative `iterationsConsumed` validation (low-priority hardening).
- Socket-backed ink E2E beyond existing `00` RPC proofs and `01` injectable fakes.
