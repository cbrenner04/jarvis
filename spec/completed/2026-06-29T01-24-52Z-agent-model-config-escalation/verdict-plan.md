# Verdict: required refinements

## 1. Pin harness-global data file scope and validation subset

The spec must state that the role→model store is **one harness-global artifact** beside `data/prices.json` (per `v2-architecture.md`), not per-project stores. Per-project variance is only the ordered `agents` list in `~/.jarvis`.

Add a ledger entry and acceptance criteria for:

- Agents present in the data file but **not** in the project `agents` list are **ignored at runtime** (not load errors).
- Missing `(agent, role)` for any project-configured agent and any required role (per closed `Role` union minus optional `operator`) is a **hard load error**.

Without this, Phase 5 cannot implement load validation unambiguously.

## 2. Document flat binding construction and link `shared-invocation.md`

Nested loops must compose with the existing flat quota-only executor contract. The spec must require `agent-model-config.md` to document how per-step bindings flatten from outer `agents` order × inner rungs (full-list or head-only `actuator`), with each outer landing resetting to `rungs[0]`, and cross-link `v2/docs/shared-invocation.md` for terminal `model_config` / `error` semantics.

Add an acceptance criterion that the durable doc states this construction rule and the shared-invocation alignment.

## 3. Add acceptance criteria for inner exhaustion → outer fallback

A load-bearing composition rule appears in task checklists but is not verified. Add criteria (canonical in subspec 00; cross-link reference in subspec 01) that:

- Quota after the last inner rung on an agent advances the **outer** agent loop for the **same role**, starting at the next agent’s `rungs[0]`.
- Head-only `actuator` quota advances **outer only** (no inner walk beyond `rungs[0]`).

## 4. Narrow “outer loop unchanged” wording

Replace claims that outer semantics are fully unchanged or match v1’s combined `{agent, model}` chain. Pin that the **outer advance trigger** is quota-only (no role-driven agent reorder), with parity baseline **patch/plan + `shared-invocation.md`**, explicitly **not** v1 prompt mode (where `model_config` can advance agents).

## 5. Add `operator` load vs runtime acceptance criteria

Decisions distinguish optional-at-load vs error-at-resolve; criteria must enforce both:

- Load succeeds when `operator` bindings are absent.
- Resolving `operator` before Phase 9 is a **runtime error**.

## 6. Extend load-validation ledger and criteria

Beyond missing-matrix hard errors, pin in ledger and verify in criteria:

- Empty `rungs` → load error.
- Duplicate entries in project `agents` → load error.

Keep unknown agent name closure and `Model` / `priceKey` validation mechanics under existing Phase 5 deferrals.

## 7. Split durable-home ownership per `documentation-standard.md`

Resolve task overlap between subspecs:

| Home | Owns |
| --- | --- |
| `v2/docs/agent-model-config.md` | Schema, validation matrix, flattening algorithm, consumption modes, terminal outcomes, price derivation, example profiles |
| `v2/docs/v2-architecture.md` | Short outer/inner composition overview + cross-link only |

Remove full loop duplication from one subspec’s task checklist. Subspec 01 should depend on subspec 00 (`agent-model-config.md` must exist first).

## 8. CLI override: interim vs target and both-flag requirement

Document interaction with shipped `write-behavior.md` (`--agents` CSV today vs target `--agent` / `--model`). Pin that override requires **both** flags, bypasses load validation and both loops for one invocation, and needs no matching `(agent, role)` entry. Add or tighten acceptance criteria accordingly.

## 9. Strengthen several existing criteria

- Name `adversary`, `advocate`, and `adjudicator` explicitly in the full-list consumption criterion (not “review debate roles” alone).
- Example profile sketch must show at least one agent with **multi-rung** escalation for a non-`actuator` role.
- State that binding lists are built **fresh per step invocation** (rung index does not carry across invocations).
- Clarify that `Model.priceKey` maps one adapter-specific row in `prices.json` (intent “per adapter” is not a multi-key map on one logical model).
- One sentence documenting accepted tradeoff: misconfigured `rungs[0]` hitting `model_config` is terminal; remedy is rung reordering.

## 10. Move spec tree to `v2/spec/`

Per route-by-target in spec guidance, this v2-only durable-doc work belongs under `v2/spec/2026-06-29T01-24-52Z-agent-model-config-escalation/`, not `v1/spec/`. Placement only; content unaffected.

---

## Not required before merge

- `v1-behaviors.md` / `v2-build-order.md` refresh — reasonable follow-on after durable docs land; not blocking this design-only slice.
- Spawn-layer transient-retry semantics, capability floors, tier→initial-rung index — correctly deferred to first consumer.
- Deduping duplicate human-only category ACs — cosmetic.
