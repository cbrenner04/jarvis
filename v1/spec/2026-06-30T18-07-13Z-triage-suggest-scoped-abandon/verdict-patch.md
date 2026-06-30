## Verdict: required refinements before merge

### 1. Gate scoped-abandon suggestions on `prState !== "unknown"`

**Outcome:** Named triage must never emit `jarvis1 cleanup --abandon <worktree-name>` when `computePrState` returns `unknown`, regardless of `checkScopedAbandonPreflight` result.

**Why:** The spec decision ledger treats `prState = unknown` (or failed PR inspection via rule matching) as ineligible for destructive suggestions. Acceptance criterion: "`prState = unknown` never emits scoped abandon." Today `buildSuggestedMovesInput` sets `scopedAbandonEligible` from preflight alone; rule 6 matches dirty + incomplete without consulting `prState`. Preflight has no `unknown` concept, so dirty + incomplete + `unknown` + preflight-eligible → rule 6 emits scoped abandon. That violates the AC.

Rule 7 is unaffected (`CLOSED`/`none` only); rule 6 is the gap.

---

### 2. Test the `unknown` + preflight-eligible intersection

**Outcome:** `triage-command.test.ts` must cover at least one scenario where preflight would be eligible (or `scopedAbandonEligible: true` is explicitly set) and `prState` is `unknown`, and assert no scoped-abandon: no `cleanup --abandon` line.

**Why:** Existing unknown-`prState` tests default `scopedAbandonEligible` to `false`. They pass without exercising the bug. Spec AC anchors preservation to tests that actually pin the behavior; the intersection case is missing.

---

### 3. Document the `unknown` prState gate in `v2/docs/v1-behaviors.md`

**Outcome:** The named-triage suggested-moves entry must state that `prState = unknown` never suggests scoped abandon, alongside the existing eligibility and rule 6/7 notes.

**Why:** Spec documentation task requires the suggested-moves delta in the durable home. Current doc covers preflight gates and rules 6/7 but omits the `unknown` suppression rule. Once outcome #1 lands, docs must match operator-facing semantics per `v2/docs/documentation-standard.md`.

---

### Not required (no actuator action)

- **Dual PR inspection paths** (`computePrState` vs preflight): spec-intentional split; outcome #1 closes the unsafe direction (`unknown` + eligible).
- **Clean vs dirty draft/open asymmetry:** spec-pinned (rule 7 vs rule 6 + fallback).
- **`isMergedPr` fail-open:** inherited from shared cleanup eligibility; out of this subspec’s scope.
- **End-to-end `buildSuggestedMovesInput` wiring test:** strengthens coverage but not spec-mandated; separate tests satisfy ACs individually once #1–#2 land.
- **Spec/impl naming** (`branchForWorktree` vs `getCurrentBranch`, `worktreeName` not passed to preflight): no behavioral gap.
