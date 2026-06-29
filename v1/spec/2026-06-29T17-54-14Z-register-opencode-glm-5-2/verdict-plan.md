## Verdict — required refinements

### 1. Broaden cost-attribution scope in problem statement and acceptance criteria

The spec pins only the `usage_source: "estimated"` enrichment path. `extractUsageAndCost` also computes harness cost when usage is present, agent-reported `cost_usd` is absent, and a price row exists (`cost_source: "computed"`). That is the same `no-price` gap this registration closes for non-primary paths.

**Required:** Intro and acceptance criteria must cover both estimator enrichment and agent-usage-without-cost enrichment for `opencode/glm-5.2`. Add a telemetry AC and matching test task for the agent-usage path (usage present, `cost_usd` null → `cost_source: "computed"` with non-null `cost_usd`).

### 2. Pin `computeCost` fixture to exercise `cache_read_per_mtok`

The owner row quotes `cache_read_per_mtok: 0.26`. A zero-cache fixture would not validate that rate.

**Required:** `prices.test.ts` task/AC must require a fixture with nonzero `cache_read_input_tokens` (same pattern as `gpt-5.4-mini` registration).

### 3. Record `cache_write_per_mtok` omission decision

Owner Zen snapshot omits `cache_write_per_mtok`; existing `opencode/deepseek-v4-flash-free` row omits it too; `computeCost` falls back to `input_per_mtok`.

**Required:** One decisions-ledger line accepting input-rate fallback for cache-write tokens (opencode row convention); add `cache_write_per_mtok` only if Zen lists a distinct field at implementation time.

### 4. Align operator-runbook documentation

`operator-runbook.md` states GLM 5.2 needs no `prices.json` row to run — still true for execution. After this spec, the row enables harness fallback costing on estimated and agent-usage-without-cost paths. Spec currently says "Documentation updates: None," which contradicts operator-facing attribution semantics.

**Required:** Replace "None" with a minimal `v1/docs/operator-runbook.md` update: row optional to run; row enables harness attribution on fallback enrichment paths. `v2/docs/v1-behaviors.md` omission remains correct (no default change).

### 5. Remove redundant tasks and ACs with no new contract

Unlike codex registration, opencode has no allowlist gate. Generic coverage already exists:

- `price-keys.test.ts`: `"opencode returns configured model unchanged"`
- `opencode.test.ts`: `--model` passthrough and raw `attributionLabel()`
- Any non-empty opencode model already round-trips config validation

**Required:** Drop `opencode.test.ts` glm-specific task/AC and config `writeConfig`/`loadConfig` glm round-trip task/AC. Keep `resolveAgentPriceKey` AC as behavioral documentation; do not add a glm-specific `price-keys.test.ts` case.

### 6. Fix intent `config.ts` line cite

Intent cites `config.ts:142` (`DEFAULT_AGENT_ORDER`); subspec correctly cites `:140` (`DEFAULT_AGENT_MODELS.opencode`).

**Required:** Align intent cite to `:140` on next intent edit.

---

**Not required:** `DEFAULT_AGENT_ORDER` pin (opencode is not in default order — structural asymmetry with codex, not oversight); rate-fetch prerequisite (owner snapshot + `source_url` matches codex precedent); `v2/docs/v1-behaviors.md` update.

**Core deliverable upheld:** owner snapshot row in `data/prices.json` plus seed/`computeCost` pin is sound and correctly scoped as registration-only opt-in. Refinements add regression signal and doc alignment without codex-parity test bulk.
