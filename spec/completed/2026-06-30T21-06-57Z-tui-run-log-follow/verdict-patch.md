## Verdict — required outcomes

### 1. Present-fields-only line projection (spec violation)

**Outcome:** Rendered lines must include `seq`, `kind`, and only those per-kind nested fields that are actually present on the record. Absent fields must not appear (no `attemptId=undefined`, empty tokens, or unconditional emission of the full per-kind column set).

**Rationale:** Subspec `01` decisions pin “present nested fields only.” `formatLogFollowLine` currently emits every pinned field per kind regardless of presence. Tests assert inclusion on complete fixtures only and do not guard omission.

**Also required:** Automated coverage for at least one partial-payload case proving absent fields are omitted from output.

---

### 2. Mid-session tail failure feedback must be operator-visible in production (AC gap)

**Outcome:** When `TuiDaemonConnectionError` occurs during an active log-follow session, the operator must see the failure feedback (`daemon_error: …`) before the process exits — not via a separate ink mount that unmounts immediately while the log-follow view remains on screen.

**Rationale:** Subspec `01` AC requires “operator-visible failure feedback” on mid-session tail failure with exit `1`. Production path calls `showTuiInkFeedback`, which renders briefly and unmounts while the log-follow ink session stays mounted, so failure copy can be missed even when exit code is correct. Injectable view-host tests satisfy the AC; production ink path does not fully deliver the contracted UX.

**Also required:** Production-path test coverage (or equivalent assertion on the active session surface) that failure feedback is visible on mid-session tail failure, not only via injectable view-host state.

---

### 3. Align `write-behavior.md` with literal line shape (doc drift)

**Outcome:** The `jarvis tui log <run-id>` row in `v2/docs/write-behavior.md` must describe the actual rendered keys (`seq`, `kind`, plus present per-kind keys), not `event.kind` as if it were the literal output token, unless the doc explicitly states that `event.kind` is the source path and `kind` is the rendered key.

**Rationale:** Durable doc is the operator contract; tests and implementation already use flat `kind=`. Mismatch will mislead operators and future implementers.

---

### 4. Scope quit semantics in `write-behavior.md` to the correct command

**Outcome:** Quit copy must not imply that `jarvis tui log <run-id>` closes the monitor’s RPC daemon client. Monitor quit (`jarvis tui`: closes daemon client, exit `0`) and log-follow quit (closes tail client / sends `stream-end`, exit `0`) must be documented separately or clearly scoped.

**Rationale:** Current prose immediately above the log-follow paragraph describes monitor teardown; log follow uses a different lifecycle seam per subspec `01`.

---

### 5. Do not silently exit `0` on unexpected consumption errors (robustness)

**Outcome:** Failures during the consume loop that are not contracted benign completion (`stream-end`, operator quit) and not the pinned `TuiDaemonConnectionError` path must not be swallowed into exit `0`. The process must exit non-zero or propagate the error.

**Rationale:** `await consume.catch(() => {})` after `Promise.race` discards any late non-tail rejection, so unexpected formatter/session errors can yield exit `0`. Subspec `01` only contracts exit `1` for tail failures, but silent success on unexpected errors is unsafe for production and undermines exit-code trust.

---

### Not required for this pass

- Single-use `records()` invariant, `close()`/`records()` startup race, strict unrelated-frame rejection, thin socket integration test, empty run-id guard, `parseStreamPayload` sharing, `waitUntilExit` stub, test rename nit, missing `run_execution_failed` e2e fixture — in-spec, precedent-aligned, explicitly deferred, or cosmetic.
- Full inline doc-comments on log-follow exports beyond tail client — repo standard applies globally, but subspec `00` AC scoped doc completeness to the tail client module; not blocking this slice’s checked acceptance criteria.
