Verifying key claims in the codebase so the verdict is grounded in observable behavior.
## Verdict: required refinements

### 1. Close the pre-ticked bypass (blocking)

The spec must require mutation-checkpoint verification when **all** non-human-only criteria are already ticked. Today `spec.criteria-ticked` registers only while unticked rows remain, so an agent can tick hollow mutation-checkpoint rows and emit `done` with no verification — the core failure mode the intent targets. The spec must state that implement writes always run checkpoint verification on ticked non-human-only criteria whose text references `Mutation checkpoint:`, separate from the unticked-row gate.

**Rationale:** Intent linkage rule (“only **ticked** … criteria … trigger verification”) is incompatible with registration gated on unticked rows.

---

### 2. Split settlement coverage across test layers (blocking)

Acceptance criteria must distinguish:
- **Contract check** (`write.test.ts`): hollow checkpoint refuses completion; valid inversion allows it; unparseable comment does not `contract_miss`; `failureReason` carries checkpoint coordinates.
- **Write-loop settlement** (`write-loop.test.ts`): `## Blocker` append and `contract_miss_detail` telemetry on `spec.criteria-ticked` miss, matching existing criteria-ticked settlement patterns.

**Rationale:** Blocker append and `contract_miss_detail` are write-loop responsibilities; concentrating them in `write.test.ts` ACs misstates the contract boundary and will not catch settlement regressions.

---

### 3. Make the regression AC independently implementable (blocking)

The regression AC cites spec directories, not replayable code snapshots, and does not name which historical hollow checkpoints constitute the “three evidence rows.” The spec must:
- Identify committed fixture material (merge SHAs or dedicated fixture trees under test data) that capture code + pinning tests at merge time.
- Enumerate exactly which checkpoint(s) from `20260801T142304Z-tui-entry-tree-viewport-and-navigation` and `20260801T160040Z-tui-entry-reversible-descend-navigation` are in scope (resolving the three-vs-four count; exclude pins that cannot be shown surviving under fixture state).
- State that regression drives verification with **synthetic ticked non-manual** criteria derived from those rows (source criteria are `(Manual)` and are skipped at runtime).

**Rationale:** Intent requires detection against historical hollow checkpoints, not assertions on current `main`; without fixture mechanics the AC cannot be implemented or independently verified.

---

### 4. Add minimum linkage and resolution rules (blocking for multi-pin)

Deferring full parse grammar is fine, but the spec must normatively state:
- How a criterion’s backtick path resolves to a pinning test file (worktree-root search; ambiguous multi-match → unparseable).
- How `// Mutation checkpoint:` comments map to pins when criterion prose names multiple pins or spans multiple lines (match comment to the `test`/`it` block whose title appears in the criterion).
- Outcomes when linkage fails: missing file, missing comment on named pin, ambiguous file match — aligned with unparseable vs hollow policy (missing checkpoint on a named pin should not silently pass).

**Rationale:** Multi-pin viewport criteria and multi-line bullets exist in the cited exemplars; “follow exemplars” alone does not close implementability for the decision “apply every linked checkpoint.”

---

### 5. Cover missing behavioral AC gaps

The spec must add acceptance outcomes for:
- **Multi-pin criterion:** one ticked criterion with two linked checkpoints where one is hollow and one is caught; completion refused until all are valid.
- **Caught-checkpoint guard pin:** symmetric to the hollow-refusal pin — inverting the caught-checkpoint guard turns its pinning test RED (intent failing-test / `guard-bare-settimeout` peer rule).
- **Unparseable reporting:** minimal observable report (e.g. injectable log event with file+line) without requiring full grammar; “does not `contract_miss`” remains the hard requirement.

**Rationale:** Spec guidance requires failing-test ACs for new runtime behavior; decisions without matching ACs leave gaps the intent explicitly closes.

---

### 6. Clarify operational semantics (non-blocking but required)

The spec must explicitly state:
- **Worktree restore** after each inversion attempt, including on scoped-test failure or timeout.
- **`no-work` parity** with `done` for mutation-checkpoint verification.
- **Scoped-test inputs:** `changedPaths` derived from inverted production guard file(s); coarseness matches existing diff-derived mutation verification.
- **Hollow-checkpoint aggregation:** collect all hollow checkpoints; include each as `path:line: comment` in `failureReason`, `contract_miss_detail`, and `## Blocker`.
- **Mixed outcomes on one criterion:** unparseable comments are reported and skipped; any remaining hollow parseable checkpoint still refuses completion; apply all linked checkpoints before accepting the tick.
- **Prerequisites** from intent copied into the subspec (diff-derived verifier, `parseSpec` assembly/human-only classification, criteria-ticked blocks `done`/`no-work`).

**Rationale:** These are implied by decisions but underspecified where implementers could diverge on restore guarantees, settlement shape, and failure composition.

---

### 7. Single subspec — upheld

Do **not** split. Intent explicitly binds checkpoint parsing/application and `spec.criteria-ticked` enforcement to one implement-completion boundary; the work is large but one atomic seam. Refinements above make the single subspec implementable without prescribing compression or file reorganization.

---

### Not required

- Splitting parser from enforcement into sibling subspecs.
- Expanding diff-derived post-commit verification (explicitly out of scope).
- Normative checkpoint parse grammar beyond exemplar-plus-minimum-linkage rules (deferred per intent).
- Rewriting intent-level ACs to duplicate harness-level failing-test pins (subspec operationalization is appropriate).