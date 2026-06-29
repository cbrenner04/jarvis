## Verdict — required outcomes before merge

### 1. Uncommitted-ticks finish call site must honor the spec’s ordered contract

At the uncommitted-ticks `tryFinishSpecIfDone` call site (~654), a `null` return must trigger `{ kind: "continue" }` as its own first branch—before any `completionLoopbackSignal` handling, `?? 0`, `completed-spec` telemetry, or terminal finish return. Numeric returns (`0`, `6`, gate loopback codes) must still follow the existing finish path unchanged.

**Why:** The subspec pins this ordering to prevent reintroducing false completion telemetry and to make clear that only the “index still has open linked subspecs” `null` path is the bug fix; merging `null` with loopback into one condition obscures that intent and diverges from the accepted contract.

### 2. `v1/docs/run-loop.md` exit `0` row must cross-reference the false-completion symptom

The multi-subspec false-completion triage pair (`criteria-complete`, `iterations: 0`, no `spec complete` on stdout) is documented only under the exit `6` uncommitted-ticks prose. Operators triaging exit `0` will not find it there.

**Why:** Acceptance criteria require durable triage documentation in `run-loop.md`. The symptom is false exit `0` / `criteria-complete`; a one-line cross-reference on the exit `0` row pointing to the exit `6` uncommitted-ticks note closes the lookup gap without duplicating the full symptom pair.

### 3. One-line inline rationale at the fix site

The uncommitted-ticks finish path must carry a brief comment explaining why `null` loops back here while `before === 0` / `after === 0` paths correctly coalesce with `?? 0`: subspec AC complete does not imply index complete.

**Why:** The contrast between call sites is non-obvious and is exactly the invariant this slice protects; inline “why” is cheap regression insurance per documentation-standard practice.

---

### Not required (no actuator action)

- **Regression test:** Covers the strengthened AC (multi-subspec fixture, `maxIterations >= 2`, commit/index/agent assertions, no exit `0`, no `spec complete` on stdout). Absence of a `completed-spec` telemetry JSONL assertion is acceptable; the bug is locked by behavioral outcomes the test already asserts.
- **`operator-runbook.md` stopgap:** Optional per completed subspec; correctly omitted.
- **Stale comments at ~470/~1571, extended multi-subspec matrix, `git: false` coverage, `mapExitCodeToReason(0)`:** Out of slice scope.
