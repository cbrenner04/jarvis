Verifying key codebase claims before issuing the verdict.
## Verdict: required refinements

### 1. Pin default catalog path depth for `shared/prices/`

The spec mandates `import.meta.dir` resolution but not how many parent segments reach repo-root `data/prices.json`. A straight copy from v1 uses three `..` segments; `shared/prices/` needs two. Without an explicit decision, a common port mistake still satisfies every current AC.

**Outcome:** State the correct relative depth from `shared/prices/` to `data/prices.json`, contrasted with v1’s three-level path.

---

### 2. Align final verification with `shared/**` consumer suites

`AGENTS.md` requires `shared/**` changes to pass `test:v1`, `test:v2`, and `test:integration:v2` (in addition to typecheck). The spec’s final AC names only `test:shared`, which is narrower than operator guidance and CI scope for this surface.

**Outcome:** Final acceptance criterion must require typecheck plus the full `shared/**` consumer union (`test:v1`, `test:v2`, `test:integration:v2`). `test:shared` may remain as supplementary coverage, not the sole test gate.

---

### 3. Reconcile the load-validation port claim with testable acceptance

Decisions require porting v1 `loadPrices` validation (version checks, negative-rate rejection, malformed rows). All acceptance criteria exercise only `loadPrices()` against the checked-in catalog via `cost.test.ts`. An implementer can ship a trivial `JSON.parse` wrapper and complete the spec.

**Outcome:** Either add acceptance criteria for minimal load validation (at least unknown version and negative-rate rejection, mirroring v1’s temp-file cases), **or** narrow the load-port decision to default-path resolution plus checked-in catalog shape only. The decision and ACs must match.

---

### 4. Reconcile v1 edge-case parity language with enforced test surface

The decision that the port “rules out a simplified reimplementation that diverges on edge cases v1 already pins” is stronger than what the ACs enforce. Covered paths: Composer 2.5 pin, unknown key, `no-usage`. Not covered: all-null rates → `no-price`, partial-null tokens, all-zero tokens → `computed` with `0`, cache-rate fallback when cache columns are absent, `undefined` usage with unknown key → `no-price` (v1 ordering).

**Outcome:** Either add a small set of focused regression cases for the highest-risk uncovered branches (recommend at least all-null rates, all-zero `computed`, and cache fallback without explicit cache columns), **or** soften the parity decision to “port v1 source; branches not covered here remain v1’s regression until delegation.” Do not leave the strong parity claim with only the Composer pin as evidence.

---

### 5. Make guard-inversion verification agent-verifiable

The guard-inversion AC requires manual source mutation and a comment checkpoint but carries no `(Manual)` marker and no AC binding the checkpoint text to a named test. Spec guidance treats non–human-only ACs as worktree-verifiable; manual mutation is not.

**Outcome:** Mark the guard-inversion AC `(Manual)` (consistent with repo practice when production invert hooks are forbidden), **and** add an automated AC that the Composer 2.5 pin test includes a comment checkpoint naming the required mutation (e.g. omitting `cache_read_input_tokens` from the sum). This preserves traceability without stranding the implement run.

---

### 6. Align intent acceptance criteria with the subspec contract

`intent.md` still says cost “matching `data/prices.json` to the cent” and requires only `test:shared`. The subspec correctly pins `0.0038492` and inherits the same verification gap.

**Outcome:** Align intent AC wording with the subspec’s exact pinned value (or “matches catalog arithmetic for pinned fixture”) and the expanded verification scope from refinement #2, so seed and implementable spec do not diverge.

---

### 7. Document fixture provenance (minor, recommended)

`COMPOSER_25_FIXTURE_USAGE` matches real cursor terminal-frame usage from `v2/spec/seeds/cursor-usage-is-parsed-then-discarded.md` and arithmetic against current `Composer 2.5` rates, but the spec does not say why those numbers were chosen.

**Outcome:** One decision bullet citing the seed as fixture source, so future catalog or fixture edits retain rationale.

---

### Rationale summary

Refinements #1–#5 close concrete failure modes: wrong default path, under-verification relative to repo rules, decision/AC mismatch on load validation and v1 parity, and an AC that spec guidance classifies as non-automatable. #6 keeps intent and subspec consistent. #7 is documentation hygiene for a long-lived pin.

**No split required.** One subspec remains appropriate if load validation is covered by a focused `load.test.ts` (or the load decision is narrowed) without expanding beyond a single commit-sized slice.

**Explicitly not required:** cross-suite v1↔shared drift guards, v1 delegation, invocation wiring, or naming every export for the sibling intent — those stay correctly out of scope for this extraction.