# Adjudicator verdict — role-resolution-taxonomy

## Required refinements

1. **Pin shrink step role in subspec 00 (echo in 03).** The closed seven-role union must assign a step role for post-completion shrink (`write` loop on implementation artifacts). Today subspec 03 maps `reviewActuator` → `actuator` without separating shrink from verdict actuator; v1 shares one tier with different consumption (verdict head-only, shrink full-list). Taxonomy cannot defer this to agent-model-config — that slice owns config shape, not which role a workflow step names. Record the step-role decision in the ledger; document v1 tier equivalence with an explicit shrink vs verdict-actuator footnote in the mapping prose.

2. **Resolve shrink toward `implement`.** Among the closed roles, shrink is implementation cleanup under `write`, not review-and-update verdict application. Mapping shrink to `actuator` would stretch one role across both behaviors and contradict the `reviewActuator` → `actuator` (verdict-only) tier split. If the refiner rejects `implement`, the ledger must name the alternative and why it still satisfies one-`actuator` and behavior semantics.

3. **Fix stale intent scope bullet.** Remove or reword “Pin open taxonomy decisions listed below” — `## Decisions` lists only settled choices and deferrals, not an open list. Align scope with what subspecs actually pin.

4. **Replace bare `rg` acceptance criteria (subspecs 00–02).** Current checks false-fail on benign English (e.g. `loop Promise is executing` in `v2-architecture.md`) and false-pass on category-as-resolution-key prose the pattern misses. Either tighten patterns to category-resolution phrases, or mark category retirement `(Manual)` and treat `rg` as advisory. ACs must be verifiable without semantic guesswork.

5. **Strengthen subspec 00 acceptance criteria.** Beyond union membership and row count, require: per-role behavior in the reference table (including `human` = no agent resolution; `operator` = behavior binding deferred); step-binding contract (`behavior` + `prompt` + `role`; outer agent fallback, inner `(agent, role) → model` with rung detail deferred); cross-link to `v2-vision.md`; shrink row once pinned.

6. **Broaden subspec 01 acceptance criteria.** Cover terminology block and workflow step prose that still cite “model category” (not only layered-model table, per-project config, review-debate). Category retirement must span all resolution-key occurrences tasks already bind.

7. **Broaden subspec 02 acceptance criteria.** Include composability summary prose (e.g. steps naming category as inputs) or an explicit “all category-as-resolution-key occurrences” outcome — tasks already require “throughout”; ACs must match.

8. **Record `v2-build-order.md` deferral in subspec 00 ledger.** Stale category prose there is a reader-confusion risk but full rewrite exceeds this slice. One ledger entry: deferred refresh when agent-model-config or Phase 5 implementation lands — rules out silent inconsistency across v2 docs.

9. **Optional (not blocking):** subspec 03 AC for verdict-actuator vs shrink consumption quirk; one-line plan-mode `[v2 divergence]` note that v1 combined `agentOrder` maps by step role at workflow level. Intent limits subspec 03 to `subRoleAgentOrder`; omit if scope discipline matters more than parity completeness.

## Upheld without change

- Canonical `role-resolution.md` home, behaviors-as-primitives, one `actuator`, `cheap`/`operator` deferrals, no v1 migration, subspec split and index order, structural/doc-contract ACs for this slice, `reviewPanel` → three roles / one tier (config shape deferred to agent-model-config), spec location under `v1/spec/` (convention only).

## Rationale (load-bearing)

Shrink is the only named v2 workflow step in existing architecture/vision that lacks a role under a closed union — leaving it open makes subspec 00 incomplete relative to intent (“Document role ↔ behavior mapping”). Weak ACs let thin or wrong docs satisfy checkboxes while Phase 5 and `agent-model-config-escalation` consume incomplete contracts; spec guidance requires behavioral, verifiable acceptance criteria where possible.
