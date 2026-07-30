Verifying the advocate's key claims against the code and docs before issuing the verdict.
## Verdict

### 1. Correct gate-only finalization step order in durable docs

**Outcome:** `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` must describe the exhausted-red gate-only resume tail in the same order as the subspec decision and `createReadyFinalizer`: operator commit when needed, then **ready gate**, then mutation verification, then runtime smoke, then draft→ready flip.

**Rationale:** The PR introduced reversed ordering (“mutation verification, ready gate, runtime smoke”). That contradicts the subspec, the existing ready-finalization section in `write-behavior.md`, and runtime behavior. Operator docs must not misstate recovery steps.

---

### 2. Bind exhausted-red terminal origin to successful checkpoint persistence

**Outcome:** `readyGateOrigin: repair_budget_exhausted` (and paired `readyGateRepairCount`) must not be recorded on terminal evidence unless the retained finalization checkpoint was actually persisted for that run. Origin and checkpoint are one eligibility contract; partial stamping must not occur.

**Rationale:** Today `persistRetainedFinalizationCheckpoint` can no-op while origin is still returned and logged. That can emit exhausted-red terminal evidence without a checkpoint, causing gate-only admission to refuse while the row still advertises exhausted-red lineage. The subspec requires both origin evidence and a retained checkpoint for gate-only resume.

---

### 3. Close guard-inversion gaps named in the acceptance criteria

**Outcome:** Add named regressions that go RED when these guards are inverted, beyond the existing origin-evidence inversion and matrix negatives:

- `readyGateRepairCount` mismatch (correct origin, wrong count)
- `status !== "failed"` with otherwise valid exhausted-red evidence and checkpoint
- Corrupt/unparseable checkpoint column (must refuse gate-only admission like a missing checkpoint)

**Rationale:** The subspec requires inverting **each** added guard. Core negatives are covered, but repair-count, failed-status, and corrupt-checkpoint guards are admitted in code without dedicated inversion coverage.

---

### 4. Assert the retained checkpoint contract before and during gate-only resume

**Outcome:** Regression coverage must prove that after repair-budget exhaustion:

- The durable row carries a retained finalization checkpoint (completion attempt lineage, completion agent, PR evidence when present) **before** resume is admitted
- Gate-only resume uses the checkpoint’s completion attribution for the operator commit/publish path (not merely “one commit call happened”)

**Rationale:** The subspec’s checkpoint contract covers persistence, lineage reuse, and attribution. Current tests verify terminal evidence and call counts but not checkpoint shape or that the committer receives the retained `completionAgent`.

---

### 5. Assert no additional `ready_gate_repair` events on repeated red gate-only resume

**Outcome:** The repeated-red lifecycle test must assert the `ready_gate_repair` event count is unchanged across each red resume attempt (same as the green-resume test).

**Rationale:** A core guarantee is gate-only replay with no write-agent or in-loop repair re-entry. The green path asserts this; the repeated-red path should too so repair suppression cannot regress silently.