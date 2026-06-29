## Verdict — required outcomes

### 1. Narrow `intent.md` to match subspec scope

**Outcome:** `intent.md` must describe upstream setup only on paths that reach the finalize push (dirty finalize; clean only when unpushed commits are detectable via `computeUnpushed > 0`). It must explicitly defer clean worktree + `origin` + local commits + no upstream — the path where finalize skips push and may still open PR / gate / promote.

**Rationale:** Intent still promises behavior for any complete no-upstream worktree. That contradicts the subspec decision ledger and shipped code. Intent is the acceptance contract for this change; it must not over-promise.

---

### 2. Correct `v2/docs/v1-behaviors.md` mark-ready push wording

**Outcome:** The `--mark-ready` behavior line must:
- Drop the removed `pushWorktreeOrFail` symbol; refer to the finalize push path (`commitAndPushFinalizeDirtyWorktree` behavior).
- State `-u` only when upstream is absent **on paths that actually push** (dirty finalize; clean only when `computeUnpushed > 0`).
- Record the deferred clean + no-upstream gap so durable docs match implementation.

**Rationale:** Subspec required this doc update for a behavior change. Current text is inaccurate (stale symbol, implied blanket `-u` coverage). Documentation standard: one truthful durable home for operator/workflow behavior.

---

### 3. Warn operators about the deferred clean-tree path

**Outcome:** Durable operator-facing docs must note that `--mark-ready` on a **clean** worktree with `origin` but no upstream does **not** push local commits; stuck-red recovery that points at clean-tree `--mark-ready` must not imply automatic first-push upstream setup on that path.

**Rationale:** Runbook complete-but-dirty bullet is correct. Stuck-red recovery routes to clean-tree `--mark-ready`, where the deferral leaves commits unpushed — a footgun if undocumented. Subspec defers the fix; docs must surface the gap.

---

### 4. No code or test changes required for ship

**Outcome:** Core fix (`firstPush: !hasUpstream` on finalize push), push-failure test (real finalize commit, stubbed push only), no-upstream happy path (`@{u}` assertion), and preservation tests satisfy the scoped acceptance criteria. No actuator changes to `triage.ts` or test hardening (seam capture, `firstPush: false` pin) are required unless chosen voluntarily.

**Rationale:** AC allow `@{u}` OR seam capture; tests use `@{u}`. Scoped AC and tasks are met; remaining gaps are documentation/intent alignment, not behavioral defects.

---

**Summary:** Ship after doc/intent alignment (items 1–3). The push-flag implementation is acceptable as-is.
