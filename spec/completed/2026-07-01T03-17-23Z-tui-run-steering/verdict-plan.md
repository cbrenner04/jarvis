## Verdict: required refinements

### `01` — Monitor steering (blocking)

**1. Pin mid-session steering feedback carrier and lifecycle**

The spec pins `<code>: <message>` format but not where feedback lives or when it clears. `TuiMonitorState` today is list + `waitState` only; entry-time `show` would replace the monitor.

- Outcome: decision + AC that steering feedback is session-local inline state on the monitor view (same pattern as log-follow `feedback`), not entry-time full-screen ink.
- Outcome: pin clear rules — replace on next steering action; clear on selection change; `waitState` errors unchanged.
- Rationale: stay-open mid-session contract is load-bearing; without a carrier, implementers will fork formats or obscure the monitor.

**2. Reconcile intent “active run” with pass-through semantics**

Intent says select an active run; `01` steers the selected row and defers guards to the daemon.

- Outcome: decision — steer selected row regardless of list `isLive`; daemon rejects invalid transitions.
- Outcome: `write-behavior.md` AC adds one sentence — steering a terminal/non-active row surfaces daemon errors inline, no client pre-gating.
- Rationale: matches daemon CLI pass-through and `01`'s no-local-guards decision; intent wording overspecifies.

**3. Pin post-success `resume` → `wait` behavior**

AC says list refresh and `wait` continue; spec is silent on `resume` when prior `wait` returned quiescent.

- Outcome: decision + AC — after successful `resume`, re-issue `wait` for the selected `runId` the same way `setSelection` does (abandon prior ready snapshot; `waitState` → `pending`).
- Rationale: without this, outcome panel can show stale quiescent snapshot while the run is live again.

**4. Fix error-code test ACs to match daemon action mapping**

Bundled AC (`unknown_run`, `terminal_run`, guard violation) invites impossible fixtures (`terminal_run` from `pause`).

Per `daemon-host.md` / `daemon.ts`:
- `unknown_run` — any action
- `run_not_active` — `pause`, `kill`
- `terminal_run`, `run_in_progress`, `worktree_claimed` — `resume` only

- Outcome: split bundled error AC into provokable per-action cases (or one test per action with the correct provoking code).
- Rationale: spec guidance requires verifiable ACs; current bundle is untestable as written.

**5. Add mid-session `TuiDaemonConnectionError` steering AC**

`entryErrorFeedback` already maps connection errors to `daemon_error: <message>`.

- Outcome: AC — fixture throws `TuiDaemonConnectionError` on a steering action → monitor shows `daemon_error: <message>`, stays open.
- Rationale: closes format fork between entry-time and mid-session steering failures.

**6. Pin no-selection feedback copy**

No-selection is a no-op with feedback, but format is unpinned.

- Outcome: decision + AC — plain operator-visible string (e.g. `no run selected`), not `<code>: <message>`.
- Rationale: rules out per-implementer copy drift.

**7. Cite preservation test; add Verification doc AC**

`01` says “expectations updated for steering” — spec guidance wants the test cited, not paraphrased. Completed monitor subspec requires Verification-section updates.

- Outcome: preservation AC cites `` `v2/src/tui-entry.test.tsx` `` test `the monitor never sends steering RPCs` (invert/replace with steering expectations).
- Outcome: doc AC updates `write-behavior.md` Verification bullet for `tui-entry.test.tsx` steering scope.
- Rationale: paraphrased preservation ACs have produced false contracts elsewhere in this repo.

**8. Reconcile intent doc deferral with `01` doc ACs**

Intent defers operator docs “once UX settles”; `01` already requires behavioral doc ACs.

- Outcome: decision — `01` documents steering behavior, error format, and pass-through semantics now; production keybindings and success-feedback layout remain deferred.
- Rationale: separates settled contract from unpinned UX; avoids implementer/doc-runner conflict.

---

### `00` — Daemon steering RPCs (blocking)

**9. Pin representative error codes in co-located tests**

`00` lists daemon codes in decisions but ACs don't require which codes tests must cover. Sibling `00-tui-daemon-run-rpcs` pins concrete cases.

- Outcome: AC — co-located fakes cover at least `unknown_run` plus one guard code per method family (`run_not_active` for `pause`/`kill`; `terminal_run` or `run_in_progress`/`worktree_claimed` for `resume`).
- Rationale: “representative daemon error codes” in task checklist is not verifiable without pinning.

**10. Extend type-level doc-comment AC**

New-method AC exists; existing `TuiDaemonClient` export doc-comment can go stale.

- Outcome: AC — update `TuiDaemonClient` inline doc-comment to include steering methods in the export contract.
- Rationale: documentation-standard places symbol contract in the primary export doc-comment.

---

### Optional (non-blocking)

- `00` socket-backed multiplex AC — parity with completed run-RPC subspec; fake deferred-`wait` AC already covers the multiplex decision.
- Production-ink read-only regression AC until keybindings land — low value while steering verifies via injectable `monitor-controls` only.
- `invalid_params` wire test in `00` — low priority given monitor no-selection no-op rules out empty `runId`.

---

### Upheld without change

- Two-subspec split, wire/error-type decisions in `00`, entry `1` vs mid-session stay-open split, injectable `monitor-controls` seam, `v1-behaviors.md` update, kill confirmation deferred to production keybinding refine.
- `pause`/`kill` while `wait` pending inherits monitor behavior — no new AC unless refine wants an explicit inheritance note.
- Mid-session silent `list` failures after steer — inherited from monitor; preserve decision is correct.
