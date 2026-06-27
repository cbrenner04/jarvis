# Verdict: `triage --merge`

The command-layer design matches the spec, but the operator-facing path is broken and the CI gate is fail-open. Acceptance criteria are not satisfied for real use until the outcomes below are met.

## Required outcomes

### 1. Operator CLI path must reach `--merge`

`jarvis1 triage <worktree-name> --merge` must invoke the gated merge flow end-to-end. Today `--merge` is parsed but not forwarded from `run()` to `triageCommand`, so the flag has no effect at the CLI. This violates AC1–AC8 for the primary invocation surface.

**Rationale:** The spec folds behavior into `triage`; the CLI is the operator contract.

---

### 2. CI polling must consume real `gh` check data

`gh pr checks --json` exposes `state` and `bucket`, not `status`. Production fetch must read the actual fields and normalize them into the spec's green/pending/red buckets (including case and vocabulary differences between `gh` output and the semantic tokens in the spec).

**Rationale:** Spec decision #3 commits to pollable JSON; wrong fields cause silent fetch failure. Spec decision #2 requires explicit state classification — operator-visible via refusal messages.

---

### 3. CI gate must be fail-closed, not fail-open

Both gates are hard per spec. The following must **not** be treated as CI-green or proceed to merge:

- `gh` fetch errors or unparseable responses
- Empty check lists (e.g. checks not yet registered after `gh pr ready`)
- Check states outside the spec's green set (unknown/future states, normalization failures)

Pending/unresolved checks must wait per spec; only checks explicitly classified green may proceed. Red checks must abort with the failing check name reported (AC2).

**Rationale:** The feature exists to prevent skipping the green gate. Treating errors, emptiness, or unmapped states as green directly contradicts spec intent and AC1/AC2/AC4.

---

### 4. Tests must prove production-shaped behavior

Existing command-layer tests inject a non-`gh` `status` schema and bypass the CLI, so they do not validate the operator path or real classification. Add coverage so AC8 holds against realistic data:

| Scenario | Required |
|---|---|
| Green → merge | ✓ (exists; must use normalized `gh` shapes) |
| Red check → refuse | ✓ (exists; must use normalized `gh` shapes) |
| Pending → wait → resolve | ✓ (exists) |
| Poll timeout → refuse | **Missing** |
| Local gate fail (draft) | ✓ (exists) |
| Local gate fail (already-ready PR) | **Missing** (AC3 extension) |
| Already-ready → merge | ✓ (exists) |
| Merged/closed → reject | ✓ (exists) |
| `--merge --mark-ready` → usage error | parseArgs only; needs `run()` coverage |
| Missing worktree name → usage error | parseArgs only; needs `run()` coverage |
| CLI E2E via `run()` with `--merge` | **Missing** (compounds outcome #1) |
| Classification matrix (all spec buckets) | **Missing** |

**Rationale:** AC8 claims behavioral coverage without network access; the task checklist enumerates these scenarios. Tests that pass on the wrong schema give false confidence on a safety-critical merge gate.

---

### 5. Documentation must match implemented semantics

**`v1/docs/operator-runbook.md`:** Line 222 ("Admin-merge skips approval and CI…") must be scoped to **manual** `gh pr merge --admin --squash` only. The `--merge` path enforces CI; leaving the unqualified line contradicts the spec's doc update and misleads operators steered toward `--merge`.

**`v2/docs/v1-behaviors.md`:** The `--merge` entry must document usage errors already implemented in `parseArgs`: worktree name required, `--merge`/`--mark-ready` mutual exclusivity — matching how `--mark-ready` preconditions are documented.

**Rationale:** Spec documentation updates section; operator-facing semantics must be accurate.

---

## Lower priority (not release blockers, but spec gaps)

- **Configurable poll timeout:** Spec decision says "configurable ceiling (default ~30 min)." Implementation hardcodes 30 min with only a test seam. Either expose an operator-facing knob (CLI or config) or accept a spec/doc narrowing — default + bounded behavior is met; configurability is not.
- **Timeout pending-check reporting:** With multiple concurrent pending checks, the reported name should reflect what is still blocking at timeout, not merely the first seen.
- **Command-layer flag precedence:** If both `merge` and `markReady` are set programmatically, behavior is undefined; CLI blocks this today. Defense-in-depth only.

---

## Out of scope (no actuator action)

- `isSpecComplete` vs acceptance-criteria depth: `--merge` reuses `--mark-ready` preconditions per explicit spec decision; changing completeness semantics is a separate spec.
- `sleepMs` no-op outside Bun: acceptable for this harness.

---

## Summary

**Ship blockers:** outcomes 1–5 (items 1–4 in the table are the critical path; doc fixes in 5 are required by the spec but secondary to wiring and gate safety).

Until outcomes 1–3 are fixed, `jarvis1 triage <worktree> --merge` either does nothing useful or can admin-merge without verifying CI — the exact failure mode this spec was written to prevent.
