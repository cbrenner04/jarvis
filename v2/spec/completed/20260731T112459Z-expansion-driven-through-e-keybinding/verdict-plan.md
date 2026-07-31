Verifying key code seams cited in the review so the verdict is grounded in the repo.
## Verdict: required refinements

### 1. Correct the lead acceptance criterion for coverage, not TDD

The primary AC must not claim the new regression “fails against baseline and passes after implementation.” Prerequisites confirm `e` → `toggleSelectedWorkflowExpansion` → rendered constituent rows already works; this subspec closes a test gap on existing wiring. Rewrite the lead AC as a **passing regression contract**: a named test drives `e` through the injected input handler, does not seed `expandedWorkflowInvocationIds`, and asserts rendered constituent rows appear on the first press and disappear on the second.

**Rationale:** Spec guidance’s failing-test AC applies to new runtime behavior. Mislabeling coverage as TDD can block an honest tick or mislead implementers.

---

### 2. Record the `inkRender` injection-type decision

Add a decision that `RunTuiEntryDeps.inkRender` must accept the same injection shape `openInkMonitor` already takes (`InkRender | InjectedInkUi`), so `runTuiEntry` tests can supply `useInput` without unsafe casts. Scope is type alignment only; no operator-visible behavior change.

**Rationale:** The spec’s chosen seam (`runTuiEntry` + injected `useInput`) is blocked today by a type mismatch between entry deps and ink monitor injection.

---

### 3. Clarify the integration seam in decisions and tasks

Replace ambiguous “same seam as `tui-ink-monitor.test.tsx`” wording. The spec must state explicitly that coverage combines:

- `inputHarness`-style `InjectedInkUi` / `useInput` injection (ink monitor test pattern), and  
- `runTuiEntry` without `viewHost` (entry test pattern),

so the test exercises `tui-entry.tsx`’s real `toggleSelectedWorkflowExpansion` wiring—not ink monitor in isolation with a no-op control stub.

**Rationale:** The intent’s gap is entry-level wiring proof; ink-only tests deliberately stub the control.

---

### 4. Pin entry-test mechanics and fixture invariants

Tasks/decisions must specify enough for a reproducible entry-path test:

- Use `createRefreshScheduler()` (or equivalent no-op scheduler) to avoid refresh races.
- Fixture is a collapsed multi-member workflow with an **in-progress** member so terminal-window filtering and `firstSelectableRunId` resolve to the **collapsed workflow representative** (workflow-bound selection), not a bare standalone row or a queued-only member.
- Initial rendered state shows one top-level workflow row; `e` is not a silent no-op.

**Rationale:** “Reuse collapse test run shape” alone omits entry-specific filtering, selection, and polling behavior that can make the test flaky or vacuous.

---

### 5. Pin concrete rendered assertion targets

Replace vague “both constituent run ids” / “distinct role labels” with the observable contract already proven in `tui-monitor-workflow-collapse.test.ts` for the standard three-member fixture:

- **Collapsed:** constituent `run-implement` absent; workflow step label visible.
- **Expanded:** `run-implement` and `run-review` visible with `role:implement` and `workflow-step:implement-review/actuator` respectively (`run-verify` excluded as queued).
- **Re-collapsed:** back to one top-level workflow row.

**Rationale:** Rendered-row assertions must be unambiguous enough that a no-op control stub or wrong selection cannot pass.

---

### 6. Name the regression test in the lead AC

The lead AC must cite a concrete `test("…")` name (e.g. driving workflow expansion through the injected input hook), not only the file.

**Rationale:** Repo convention and guard-inversion comment checkpoints require traceability to a named test.

---

### 7. Document the full test lifecycle in tasks

Tasks must cover: await monitor open / first render after list hydration → capture row texts → press `e` → assert expanded → press `e` → assert collapsed → tear down via quit so `runTuiEntry` resolves. Include post-press render flush (same pattern as existing ink input tests).

**Rationale:** Omitting lifecycle leaves implementers guessing on async open, assertion timing, and session teardown.

---

### 8. State the assertion/helper approach and accepted layout tradeoff

Decisions should note that assertions read concatenated rendered row texts from the ink capture tree (extract or locally duplicate helpers such as `collectRowTexts` / `joinMonitorRow` as needed), and that injected UI’s Fragment layout (no `Box`) is an accepted pre-existing gap—same as existing ink input tests—not a layout-parity goal for this subspec.

**Rationale:** Prevents scope creep into Box/layout parity or blocked implementation waiting on shared test extraction.

---

### 9. Clarify guard-inversion verification model

Keep the manual `(Manual)` AC for comment checkpoints naming both guard mutations. Add a brief decision note that **rendered round-trip assertions** are the automated proof that wiring is live; manual mutations confirm those assertions fail under guard removal without introducing `setInvert*ForTest` production hooks.

**Rationale:** Harness guard-inversion guidance expects negative proof; manual checkpoints alone are belt-and-suspenders and should not be mistaken as the sole automated contract.

---

### Not required

- **Splitting the subspec** — one atomic, independently testable slice remains correct.
- **Preservation cite for `tui-monitor-workflow-collapse.test.ts`** — optional hardening; the new test should fail broken collapse logic by construction.
- **Echoing prerequisites in the subspec** — optional for a single-subspec index.
- **Mandating shared test-module extraction** — implementer may duplicate helpers locally.