## Verdict: required refinements

### 1. Problem statement and test contract

- **Refine Problem:** Mark the `shell_snapshot validation failed` line as illustrative noise only; it does not match current `modelConfigurationPatterns`. State the reproducible failure as co-occurring **strict quota** + **real model-config pattern** (e.g. codex `You've reached your usage limit` + `unknown model`).
- **Pin new-behavior AC and test task:** Require a fixture whose stderr actually hits both `isQuotaSignal` (strict) and `isModelConfigurationSignal`; name agent (`codex` suffices) and both phrase classes. Do not use shell_snapshot as the contract fixture.

### 2. Documentation single-home (`v2/docs/documentation-standard.md`)

- **`agent-cli-failure-pipeline.md` is canonical** for full spawn classification order (`transient → auth → quota → model_config`) and for separating settlement classification from post-settlement transient retry.
- **`quota-signals.md`:** Add co-occurrence matrix row + short order line **cross-linking** pipeline; do not duplicate a second full precedence list.
- **Tighten doc ACs** accordingly — current wording mandating full order in both files conflicts with single-home policy.

### 3. Pipeline doc corrections (in scope when touching precedence)

- Step 3 must include **transient** and **auth** branches and place **quota before model_config** (currently wrong and incomplete).
- Step 4 transient cap must match code/`quota-signals.md` (**3 re-attempts, 4 total spawns**; pipeline currently says 2/3).
- Clarify that classification runs in `checkSettlement`; transient retry is `runAgent`'s post-settlement loop on `kind: "error"` — step 3/4 must not read as one combined precedence chain.

### 4. Outcome matrix row

- Add row: non-zero exit + **both** strict quota and model-configuration signals → `kind: "quota"`.
- Patch and plan columns: **rotate immediately** (same as strict-quota row); exit/telemetry same as strict quota.

### 5. `v2/docs/v1-behaviors.md` parity

- Update **both** spawn-order bullets (line ~292 Quota detection section and line ~402 Agent-failure pipeline section) to `transient → auth → quota → model_config`.
- Add co-occurrence note: dual-match → `quota`, not `model_config`.
- Vague “order note” AC is insufficient per behavior-catalog rule for existing-functionality changes.

### 6. Decision record (load-bearing only)

- **Strict quota only at spawn** wins over model_config when both match — rules out weak-quota / lenient-upgrade text winning at settlement.
- **Auth + strict quota + model_config** → `quota` with `authFailure: true` (auth branch first) — rules out quota or model_config winning when durable auth also matches.
- **Transient + strict quota co-occurrence** unchanged (transient still wins) — rules out expanding this subspec to reorder transient vs quota; separate intent if desired.

### 7. Task checklist gaps

- Include updating the `spawn.ts` classification-order comment (~line 90).
- Broaden pipeline doc task to cover step 3 full order, step 4 cap, and classification-vs-retry separation — not precedence bullet alone.

### 8. Explicitly out of scope (optional clarity, not blocking)

- Claude exit-0 adapter reclassification.
- `shouldAdvance` / mode-layer cascade policy.
- Transient-vs-quota precedence change.
- Operator shell rc fix for codex snapshot warnings.
- Pipeline transient-cap fix may be **deferred** only with an explicit Out of scope line; otherwise fix it in the same doc touch.

---

**Rationale:** Core approach (spawn reorder, single subspec, preservation ACs citing pinning tests) is sound and matches intent. Refinements close gaps between spec contract and verified code/docs: illustrative example ≠ matcher, dual-match is the real bug; doc tasks must align canonical homes and fix known stale pipeline/`v1-behaviors` drift; matrix and decisions must pin co-occurrence semantics implementers could otherwise get wrong.
