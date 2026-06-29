## Verdict — required refinements

### 1. Align Tasks with Decisions on post-output fixtures
Tasks mention “post-output stall tails” but Decisions exempt `emit-then-hang.sh` (`sleep 60` keepalive, not a tail primitive). Tasks must name the exempt script explicitly and must not imply it is in scope.

### 2. Rule on the post-output hot loop in `idle watchdog disabled when idleOutputTimeoutMs is 0`
That inline `idle-hang.sh` emits stderr then uses `while true; do :; done` — same CPU-burn pattern, different semantics from silent-idle fixtures. The spec must state explicitly whether it is in or out of scope. **Include it** (swap to the blocking primitive; watchdog behavior unchanged) so the anti-spin intent and substring AC stay consistent; if exempted, record rationale and accept the hot loop remains.

### 3. Add a shared-primitive decision
“Single subspec” bounds file count, not consistency. Record that one blocking literal (e.g. via `IDLE_HANG_BODY` or equivalent) is reused at every in-scope silent-idle site and inline override — rules out per-file ad hoc primitives (`tail` vs `read` vs `pause`).

### 4. Extend structural AC to all in-scope script bodies
First AC must cover every in-scope hang body: `IDLE_HANG_BODY`, `idleHangAgent(...)` defaults and overrides (including ~L1028 inline string), `writeAgentScript('idle-hang.sh', …)` inline bodies, and named fixture scripts in Tasks — not only files named `idle-hang.sh`.

### 5. Replace paraphrased preservation ACs with cited test titles
Per spec guidance for behavior-preserving changes, drop “idle-output watchdog integration tests stay green” and “idle watchdog debate and actuator tests stay green.” Pin each affected test by exact title, e.g.:
- `run.sandbox-unrunnable.test.ts`: idle-watchdog tests that ride on `IDLE_HANG_BODY` / `idleHangAgent()` (at minimum the seven titles using those fixtures, plus the ~L675 test if in scope per #2)
- `shrink.sandbox-unrunnable.test.ts`: `"idle watchdog timeout fires in shrink phase"`
- `review.sandbox-unrunnable.test.ts`: `"idle watchdog timeout fires in review debate phase"` and `"idle watchdog timeout fires in review actuator phase"`

### 6. Add preservation pins for adjacent touched/exempt fixtures
- **In scope:** `"watchdog timeout records watchdog_descendants_alive false for agent-only stall"` — `agent-only-hang.sh` is changed; behavior must stay green.
- **Exempt:** `"watchdog timeout records last_output_age_ms from early output then stall"` — `emit-then-hang.sh` stays unchanged; AC must pin that test explicitly.

### 7. Keep exempt fixtures explicit in Decisions and AC
`ignore-term.sh` / descendant-kill hot loops and `emit-then-hang.sh` must remain named exemptions in both Decisions and preservation ACs so implementers do not “fix” them while grepping `while true`.

---

**No refinement required:** durable docs omission (test-fixture internals; watchdog semantics unchanged); dedicated killability AC (covered by existing idle + descendant tests); preamble/style per script (`set -euo pipefail` vs not).

**Optional (not blocking):** tighten AC beyond the `while true; do :; done` substring; echo `exec tail -f /dev/null` in AC for decision parity; copy intent Prerequisites into subspec; host-run note for sandbox-unrunnable files.
