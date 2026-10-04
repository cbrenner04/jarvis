Verifying key implementation and documentation claims before issuing the verdict.
## Verdict: required outcomes for actuator

### 1. Align operator-runbook pre-mutation refusal order with `resetStaleWorkspace`

**Outcome:** In `v2/docs/operator-runbook.md` § Implement workflow, the pre-mutation refusal list must follow the same order as code and `v2/docs/v1-behaviors.md`: live-held → open-PR (ready / multiple) → daemon-held `(project, branch)` claim → dirty worktree.

**Rationale:** The spec documents gate order explicitly. The runbook currently lists claim before open-PR guards, which misleads operators when several guards could apply (including the spec’s claimed+dirty case, where claim must win over dirty).

---

### 2. Correct runbook text on probe vs post-retirement `start` for stale workflow claims

**Outcome:** Remove or narrow the claim that the pre-mutation probe can be **stricter** than a bare post-retirement `start` **because stale in-memory workflow claims are reclaimed at admission**. For that stale-claim case, preview matches effective admission after reclaim (retirement may proceed when `start` would admit after reclaim). Keep accurate guidance for cases where pre-mutation refusal is still correct (e.g. queued rows and live registry claims the probe rejects).

**Rationale:** Documentation updates in the subspec require honest operator semantics. The current “stricter … stale workflow claims reclaimed” sentence contradicts `previewWorkflowStartClaimAdmissionRefusal` and shared `start` behavior after reclaim.

---

### 3. Add regression coverage for fail-closed claim probe errors

**Outcome:** A test on the `resetStaleWorkspace` seam must assert that when the claim probe fails (missing `checkWorkflowStartClaim`, or RPC/throw from the probe), retirement does not run (no abandonment subprocess side effects) and refusal uses the generic `Cannot re-run incomplete spec:` path—not `worktree_claimed:`.

**Rationale:** The subspec decision requires fail-closed behavior on probe failure. That path is implemented but untested; without a test, probe wiring regressions could resume pre-fix destruction.

---

### 4. Satisfy guard-inversion AC pairing explicitly

**Outcome:** Either restore a dedicated test (e.g. always-refuse claim double, worktree intact, zero teardown) distinct from the main “claimed key” scenario, or treat the existing claimed-key test as the inverted-double negative and ensure the positive test (`claim probe reports unclaimed` / equivalent) remains paired in the same describe block. The checked AC text requires both “retirement when gate off” and “no retirement when double always refuses claim.”

**Rationale:** `resetStaleWorkspace refuses when worktree key is claimed` covers the negative behavior; the positive inversion test exists. If the harness treats the AC as one checkbox, document in a brief test comment that the claimed test is the inverted-double case—or add the small duplicate-negative test the branch summary once had so the AC’s pairing is obvious in review.

---

### 5. Tighten `cleanup.test.ts` claimed-key test artifact assertions (minor)

**Outcome:** The test named in the AC should assert local branch and open draft PR remain, not only worktree, remote, and zero teardown calls.

**Rationale:** Acceptance criteria name local branch and open PR intact; assertions should match stated outcomes.

---

### 6. Document claim-probe RPC failure for operators (minor)

**Outcome:** In the same runbook § (pre-mutation refusals or “Workflow reports a stale worktree claim”), note that daemon claim-check failures refuse with the generic incomplete-spec wrapper and perform no retirement—distinct from `worktree_claimed:` and from live-held’s tolerant list behavior.

**Rationale:** Fail-closed probe errors are a real operator path; the subspec chose them intentionally and they are absent from runbook recovery text.

---

### Not required before merge (accept or defer)

- Pre-mutation check for intent-invocation `worktree_claimed` (out of subspec scope).
- `check_workflow_start_claim` during daemon retire / `daemon_superseded` race.
- Separate `plan` workflow test (shared seam + one implement regression per spec).
- End-to-end test of `createStaleResetDaemonClient` beyond daemon `check_workflow_start_claim` tests and workflow stubs.
- Consolidating test-local `daemonClientWithFreeClaimProbe` with production helpers (quality only, not spec).