# Agent model config durable doc

## Problem

v2 splits agent fallback from role→model resolution (`v2/docs/role-resolution.md`,
`v2/docs/v2-architecture.md`) but lacks a canonical home for `AgentModelConfig`
schema, inner rung escalation, validation rules, and price derivation. Phase 5
implementation is blocked on this design contract.

## Decisions

- **Durable home is `v2/docs/agent-model-config.md`** — rules out folding the
  schema into `v2-architecture.md` or `role-resolution.md`.
- **`ModelEscalation` is an ordered `rungs` list** — harness tries
  `rungs[0]`, then `rungs[1]`, … — rules out unordered pools and
  config-defined non-quota escalation triggers.
- **Inner rung advance is quota-only** — rules out v1-style no-progress rung
  escalation at the model axis (no-progress remains an outer-loop concern only
  if a future consumer adds it; not part of this schema).
- **`model_config` and `error` are terminal at the current rung** — no rung
  advance, no outer advance — rules out treating them like quota for either
  loop.
- **Per-machine `agents` is an ordered `Agent[]` name list** in `~/.jarvis`
  project config — rules out v1's combined `{agent, model}` `agentOrder`
  entries.
- **Per-agent role→model assignments live in a machine-independent data file
  beside `data/prices.json`** — version-controlled, not `config.json` — rules
  out storing `ModelsByRole` in per-machine config.
- **Missing `(agent, role)` is a hard error at load** — rules out
  skip-with-fallback-role and silent default models.
- **Closed `Role` keys from `role-resolution.md`** — every role in the union
  except `operator` must have a `ModelEscalation` entry for each agent listed
  in the project `agents` order — rules out category keys and rules out
  omitting `operator` before Phase 9 wires it.
- **`operator` bindings optional until Phase 9** — when absent, load succeeds;
  resolving `operator` before Phase 9 is a runtime error — rules out requiring
  placeholder operator rungs in every profile today.
- **Full-list rung consumption** for `plan`, `implement`, `adversary`,
  `advocate`, `adjudicator` — quota on rung *i* tries rung *i+1* on the same
  agent before outer fallback — rules out head-only consumption on write/review
  roles.
- **Head-only rung consumption for `actuator`** — only `rungs[0]` is tried per
  landed agent; actuator quota advances the outer agent loop — rules out
  walking actuator rungs 1..n on the same agent (v1 `reviewActuator` verdict
  tier semantics).
- **`Model` carries `adapterModel` + `priceKey`** — `adapterModel` is passed
  to the agent CLI; `priceKey` names a `data/prices.json` `models` entry —
  rules out bare agent-name price lookup and rules out implicit key derivation
  in the schema doc (validation mechanics deferred).
- **CLI `--agent` / `--model` bypasses both loops for one invocation** — fixed
  pair, no role lookup, no rung walk — rules out per-step config override.
- **Price projection uses rung order × per-step role invocation estimates** —
  document the formula; do not ship projection code in this slice.
- **Deferred to first consumer: on-disk data filename** — pin when Phase 5
  implements load — rules out inventing a filename no code reads yet.
- **Deferred to first consumer: `Model` / `priceKey` validation mechanics** —
  pin when Phase 5 implements load (adapter catalog + `prices.json` key
  existence) — rules out guessing validation ahead of the resolver consumer.
- **Deferred to first consumer: tier→initial rung index** — pin when a
  workflow consumer maps runnable `tier:` metadata to v2 — rules out porting
  v1 patch-tier ladder semantics without a caller.
- **Deferred to first consumer: capability-floor filtering** — pin when Phase 5
  wires v1 `actuationCapabilityFloor` parity — rules out inventing floor schema
  without an implementer.
- **No v1 migration or dual-write** — document equivalence only — rules out
  migration tooling in this slice.

## Task checklist

- Add `v2/docs/agent-model-config.md` as the canonical schema home.
- Document types: `Agent`, `Model`, `ModelEscalation`, `ModelsByRole`,
  `AgentModelConfig` (field names, JSON shapes, relationships).
- Document storage split: per-machine project `agents` vs machine-independent
  `AgentModelConfig` data file beside `data/prices.json`.
- Document outer agent loop (quota-only agent fallback, unchanged semantics)
  and inner rung loop (ordered models per `(agent, role)`, quota-only advance).
- Document rung terminal outcomes (`model_config`, `error`) and outer-loop
  composition when inner rungs exhaust.
- Document load-time validation rules (complete matrix, `operator` optional,
  hard error on gap).
- Document per-role rung consumption modes (full-list vs head-only `actuator`).
- Document `--agent` / `--model` CLI override interaction with role config.
- Document price derivation: `Model.priceKey` → `data/prices.json`; cost
  projection from rung order and per-role invocation counts.
- Include at least one non-normative example operator profile sketch.
- Record the load-bearing decisions above in the doc ledger.
- Cross-link `v2/docs/role-resolution.md` (role keys) and `data/prices.json`.
- Note `implement` collapses two v1 tiers under one role (footnoted; no full v1
  tier parity claim).

## Acceptance criteria

- [ ] `v2/docs/agent-model-config.md` exists and documents `Agent`, `Model`,
      `ModelEscalation`, `ModelsByRole`, and `AgentModelConfig` with JSON
      field names and relationships.
- [ ] The doc states per-machine project config holds an ordered `agents` list
      (agent names only); role→model data lives in a machine-independent file
      beside `data/prices.json` (exact filename deferred to first consumer).
- [ ] The doc states inner rung escalation is an ordered list per
      `(agent, role)`, advances **only** on quota, and treats `model_config`
      and `error` as terminal at the current rung.
- [ ] The doc states missing `(agent, role)` for a configured agent and required
      role is a hard error at load (no skip, no fallback role).
- [ ] The doc documents full-list rung consumption for `plan`, `implement`, and
      review debate roles and head-only consumption for `actuator`.
- [ ] The doc documents `--agent` / `--model` as a single-invocation bypass of
      both agent fallback and rung resolution.
- [ ] The doc documents `Model.priceKey` mapping to `data/prices.json` and how
      rung order plus role invocation counts support cost projection.
- [ ] The doc includes at least one non-normative example operator profile
      sketch.
- [ ] The doc records load-bearing decisions in a ledger and cross-links
      `v2/docs/role-resolution.md`.
- [ ] No thinking/reviewing/executing category appears as a model-resolution
      key in `agent-model-config.md`. (Manual)

## Documentation updates

- `v2/docs/agent-model-config.md` (new) — canonical schema, validation rules,
  outer/inner loop semantics, price derivation, example profiles, decisions
  ledger.
