## Verdict: required outcomes

### 1. Lock `unknown_run` on `resume` in entry tests

Subspec `01` requires co-located coverage of `unknown_run` on **any** steering action. Entry tests cover `unknown_run` for `pause` and `kill` but not for `resumeSelected`.

**Outcome:** An entry-level test must provoke `unknown_run` on `resumeSelected` and assert inline `<code>: <message>` feedback while the monitor stays open.

**Rationale:** Closes a gap against a pinned, checked acceptance criterion; prevents resume from being the only action without `unknown_run` coverage at the monitor layer.

---

### 2. Lock pause/kill success preserving the existing `wait` loop

Subspec `01` pins that after successful `pause` or `kill`, list refresh and `wait` continue on the existing monitor loop — unlike `resume`, which re-issues `wait`. Only the resume re-wait path is explicitly tested today.

**Outcome:** Entry tests must assert that successful `pauseSelected` and `killSelected` do **not** add extra `wait` calls and do **not** mutate `waitState` beyond what the pre-action monitor state already had (e.g. when `waitState` is `ready` or `pending`).

**Rationale:** The “other successful steering actions” branch is pinned in spec and operator docs but currently implied, not verified; a regression could silently re-wait or clear outcome state.

---

### 3. Lock terminal/non-active row pass-through in entry tests

Operator docs (`write-behavior.md`) and subspec `01` document steering the selected row with no client pre-gate on liveness or terminal list status — daemon rejections surface inline. Implementation follows this, but entry tests only steer `run-gamma` for **success**, not daemon rejection on a non-live/terminal row.

**Outcome:** An entry-level test must select a terminal or non-live list row (e.g. `RUN_BETA` or `RUN_GAMMA`), invoke a steering action, and assert the daemon error renders inline as `<code>: <message>` with no client-side block and the monitor stays open.

**Rationale:** Validates the documented pass-through contract that distinguishes this slice from “active run only” UX; docs AC is checked but behavior is unguarded by tests.

---

### 4. Align exported-symbol doc-comments with `documentation-standard.md`

Subspec `00` pinned client export docs; subspec `01` did not pin control-callback docs, but `documentation-standard.md` requires doc-comments on every exported symbol.

**Outcome:**
- `TuiMonitorControls.pauseSelected`, `resumeSelected`, and `killSelected` must have inline doc-comments stating purpose and contract (consistent with `selectRun` / `quit`).
- `TuiDaemonRpcError` class doc-comment must include steering RPCs (`pause`, `resume`, `kill`) in its listed scope, matching the updated `TuiDaemonClient` contract.

**Rationale:** Prevents stale or missing symbol contracts on the steering surface; low-cost hygiene on exported API the monitor and tests depend on.

---

### Upheld without action

- Daemon client steering wire params, error typing, multiplex-with-pending-`wait`, and pinned error-code fakes in subspec `00`.
- Monitor steering seam, feedback formats, lifecycle, resume → re-`wait`, entry `1` vs mid-session stay-open split, and operator doc alignment.
- In-flight steering completing after selection change (mutating RPC still reaches daemon) — consistent with pass-through semantics; not pinned by AC; defer to keybinding refine.
- Stale quiescent outcome after successful pause/kill — explicitly pinned behavior, not a defect.
- Unhandled-rejection hardening on non-typed errors, in-flight debounce, socket-backed round-trips, production ink path, and shutdown races — out of scope for this slice.
