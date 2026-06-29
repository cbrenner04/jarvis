## Verdict — required refinements

**1. Problem statement — fix dual-cause framing**

Opening paragraph must state: config validation fails today because `CODEX_PRICE_KEYS` omits `gpt-5.4-mini` (`validateAgentOrder` → `resolveAgentPriceKey` → `null`). A missing `data/prices.json` row does **not** block `loadConfig`/`writeConfig`; it breaks priced cost attribution (`cost_source: "no-price"`). The "both together" decision stays — it covers the full opt-in path (validation + priced runs), not two independent blockers at load time.

**2. CLI slug / reachability — add an explicit gate**

Intent requires `codex exec` to receive the correct `--model` value; spawn tests use a fake binary and cannot prove live CLI acceptance. The decision to pass the config string through "unless CLI inspection shows a different slug" is unenforced — registration can pass while live runs fail.

Spec must gate the external fact before merge: owner-confirmed CLI reachability for `gpt-5.4-mini` (or the actual slug if different), via `## Prerequisites` and/or a human-only smoke AC. If slug ≠ `gpt-5.4-mini`, the spec must record the verified slug and adjust passthrough expectations. Quota-pool deferral stays; CLI slug is not deferrable the same way.

**3. Cost acceptance criteria — align with existing pins**

No in-tree test today asserts correlated `CodexAgent.run` → `cost_source: "computed"` for `gpt-5.4`; `gpt-5.5` has only a price-key test. The correlated-session AC overstates existing coverage; task wording "mirror `gpt-5.4` / `gpt-5.5` patterns" is misleading.

Refine so cost verification matches harness patterns already in repo: seed-row assertion in `prices.test.ts` (template: `"checked-in seed data includes the default Codex model"`) plus `computeCost(fixtureUsage, "gpt-5.4-mini", loadPrices())` → `computed` with non-null `cost_usd`. Alternatively, keep a correlated-session AC only if it names the concrete harness (e.g. extend `codex.test.ts` with session fixture + real `loadPrices()`, on the `run-cost-claude.test.ts` model). Outcome either way: priced registration is testably pinned without inventing a new integration path silently.

**4. Config-validation AC vs task — align breadth**

AC enumerates every `validateAgentOrder` call site; the task does not. One representative `agentOrder` round-trip exercises the shared validator — sufficient. Narrow the AC to that shared path **or** state in the task that one representative field (e.g. `modes.patch.agentOrder`) is enough.

**5. Preservation AC + duplicate task — cite the pinning test**

Per spec guidance, behavior-preservation ACs must cite the pinning test, not paraphrase. Replace the bootstrap-defaults AC with: `` `config.test.ts` `"bootstraps from empty dir with defaults"` stays green. `` Remove the duplicate task "Confirm freshly bootstrapped defaults…" — tasks belong in `## Acceptance criteria` only via automated pins, not parallel checklist items.

**6. Documentation — no change**

`## Documentation updates: None` is correct. Net-new allowlist entry; defaults and published operator workflows unchanged. No `v2/docs/v1-behaviors.md` update required. Operator model-catalog gaps and stale `config.md` references are out of scope for this slice.

---

**Upheld without refinement:** negative validation guard (`run-cost-summary-integration.test.ts` rejects unknown codex models); single-subspec scope; owner pricing snapshot AC; omitting `CODEX_MODEL_LABELS`; registration-only (no default promotion); quota deferral.

**Core scope is sound** after the above refinements: `CODEX_PRICE_KEYS` + `data/prices.json` row + spawn/attribution pins + config accept + defaults unchanged + priced-cost verification aligned to existing test harness.
