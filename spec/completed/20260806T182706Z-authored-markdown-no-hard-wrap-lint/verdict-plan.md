# Verdict: authored-markdown no-hard-wrap lint and corpus reflow

## Required refinements

### 1. Gate-visible pinning tests and mutation checkpoints

Pinning suites for the custom rule and reflow script must run under `bun run test` and participate in mutation-checkpoint verification. Today, `scripts/*.test.ts` is outside the aggregate test roster and mutation scope maps to `test/` only — so the two mutation-checkpoint acceptance criteria would be unenforceable, repeating a known gap (`scripts/markdownlint-globs.test.ts`).

**Outcome:** Spec must place gate-visible pinning tests where the harness actually executes them (convention: `test/`, production code stays in `scripts/`), or explicitly extend the aggregate roster so `scripts/*.test.ts` and mutation verification cover these files. Acceptance criteria must name tests the implement agent can verify via `bun run test`.

**Rationale:** Spec guidance requires mutation directives that turn pinning tests red when applied; hollow checkpoints are a documented failure mode.

---

### 2. Unified exemption contract across rule, reflow, and prompt

Lint exemptions and reflow preservation rules currently diverge. The subspec adds list-continuation exemption (aligned with `global.no-hard-wrap`) but reflow does not preserve them; HTML blocks are lint-exempt but reflow does not mention them; reference-link definitions are reflow-preserved but not lint-exempt.

**Outcome:** One shared exemption matrix across the custom rule, `reflow:md`, and tests — explicitly covering list continuations (with a concrete indent/marker rule), block-level HTML (distinct from inline tags), and reference-link definitions (either both exempt or both joined). Both test suites must exercise the same cases.

**Rationale:** Rule and reflow must not disagree on the same file; intent’s atomic rule+reflow land assumes they enforce the same authored-markdown shape.

---

### 3. Operator repair path documentation

`reflow:md` is an operator entrypoint but documentation updates omit runbooks/README.

**Outcome:** Add `reflow:md` to operator-facing docs (runbooks and README development section, mirroring prior `lint:md` scope work) as the documented repair path when `no-hard-wrap` violations appear.

**Rationale:** Lint without a documented fix path strands operators; intent requires a committed, discoverable reflow entrypoint.

---

### 4. Reflow–lint glob/ignore parity

Reflow scope is decision-only; only lint globs are pinned today.

**Outcome:** Acceptance criterion or test asserting `reflow:md` reads the same globs and ignores as `.markdownlint-cli2.jsonc`, preventing silent drift.

**Rationale:** Intent ties both tools to the same corpus boundary.

---

### 5. Work-item wording vs harness commit ownership

Work section says agents should “commit” reflowed corpus files.

**Outcome:** Replace with worktree outcome language (land reflowed files in the worktree); Jarvis owns commits per repo rules.

---

### 6. Intent ↔ subspec synchronization

Plan-stage `intent.md` is stale relative to the subspec: mutation-checkpoint wording (directive targets production code, lives in pinning test), single vs dual mutation checkpoints, list-continuation exemption, and test-gate scope (`touched test scope` vs `bun run test`).

**Outcome:** Reconcile `intent.md` with the subspec before merge, or state explicitly that the subspec is authoritative and update intent accordingly. List-continuation exemption must appear in intent decisions or be documented as an explicit subspec extension grounded in `global.no-hard-wrap`.

---

### 7. Acceptance-criteria precision

Several criteria need tighter, verifiable wording:

| Gap | Required clarity |
|-----|------------------|
| Config registration | Restore explicit AC that `.markdownlint-cli2.jsonc` loads the `no-hard-wrap` custom rule (folded into test AC only if that test is gate-visible per #1). |
| Pre-fix failure | State whether “fails against pre-fix” means fixture config without `customRules`, wrapped fixtures before reflow exists, or similar — not git baseline alone. |
| Reflow output shape | Replace “one physical line per block” with “paragraph and list-item prose” to match decisions and prompt. |
| HTML scope | Clarify block-level HTML exemption vs inline tags in rule comments/tests. |

**Rationale:** Behavioral ACs must be agent-verifiable without ambiguity; spec guidance rejects paraphrased contracts that drift from actual behavior.

---

### 8. Merge-order dependency

A sibling prompt spec wires `global.no-hard-wrap` into write steps.

**Outcome:** Prerequisites or a note stating whether implement requires that spec merged first, or confirming prompt fragment is already on the branch baseline.

**Rationale:** Prerequisites are validation gates; undeclared ordering risks implement against missing prompt infrastructure.

---

## Not required

- **Subspec split:** Intent explicitly forbids rule-only then reflow-only commits to avoid an intermediate red gate. One subspec serving rule, reflow, corpus migration, and docs is the decided trade; large diff is intentional review cost, not grounds to split.
- **Shared golden fixtures / dual-parser unification:** End-to-end contract (`reflow:md` then `lint:md` zero on corpus) plus parallel exemption-matrix tests is sufficient for v1.
- **Write-step autofix / `markdownlint --fix`:** Out of scope; defer to sibling work. Optional one-line out-of-scope note acceptable.
- **Reference-link asymmetry urgency:** Low immediate risk (empty corpus today) but must be resolved in the unified exemption matrix (#2), not left implicit.

---

## Summary

The core design (token-stream custom rule, deterministic `reflow:md`, atomic land, `MD013` off, existing glob scope) is sound. Refinement is required where procedural and contractual gaps would produce hollow mutation checkpoints, rule/reflow disagreement, or operator confusion — not where intent already made an explicit tradeoff.