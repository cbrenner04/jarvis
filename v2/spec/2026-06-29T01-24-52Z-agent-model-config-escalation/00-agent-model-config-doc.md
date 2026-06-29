# Agent model config durable doc

## Problem

v2 splits agent fallback from role→model resolution (`v2/docs/role-resolution.md`,
`v2/docs/v2-architecture.md`) but lacks a canonical home for `AgentModelConfig`
schema, inner rung escalation, validation rules, and price derivation. Phase 5
implementation is blocked on this design contract.

## Decisions

- **Durable home is `v2/docs/agent-model-config.md`** — rules out folding the
  schema into `v2-architecture.md` or `role-resolution.md`.
- **Role→model store is one harness-global artifact** beside `data/prices.json`
  (`v2/docs/v2-architecture.md`) — rules out per-project role→model stores;
  per-project variance is only the ordered `agents` list in `~/.jarvis`.
- **`ModelEscalation` is an ordered `rungs` list** — harness tries
  `rungs[0]`, then `rungs[1]`, … — rules out unordered pools and
  config-defined non-quota escalation triggers.
- **Inner rung advance is quota-only** — rules out v1-style no-progress rung
  escalation at the model axis (no-progress remains an outer-loop concern only
  if a future consumer adds it; not part of this schema).
- **`model_config` and `error` are terminal at the current rung** — no rung
  advance, no outer advance — rules out treating them like quota for either
  loop; aligns with `v2/docs/shared-invocation.md`.
- **Per-machine `agents` is an ordered `Agent[]` name list** in `~/.jarvis`
  project config — rules out v1's combined `{agent, model}` `agentOrder`
  entries.
- **Per-agent role→model assignments live in the harness-global data file
  beside `data/prices.json`** — version-controlled, not `config.json` — rules
  out storing `ModelsByRole` in per-machine config.
- **Agents in the data file but absent from project `agents` are ignored at
  runtime** — not load errors — rules out requiring data-file rows to match
  every project's agent list.
- **Missing `(agent, role)` for any project-configured agent and any required
  role is a hard load error** — rules out skip-with-fallback-role and silent
  default models.
- **Empty `rungs` is a load error** — rules out zero-length escalation lists.
- **Duplicate entries in project `agents` is a load error** — rules out
  ambiguous outer-loop order.
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
- **Quota after the last inner rung on an agent advances the outer agent loop
  for the same role** — next agent starts at `rungs[0]` — rules out stopping
  when inner rungs exhaust on one agent.
- **Binding lists are built fresh per step invocation** — rung index does not
  carry across invocations — rules out cross-invocation rung cursor state.
- **Flat binding construction** — per step, flatten outer `agents` order × inner
  rungs (full-list or head-only `actuator`); each outer landing resets to
  `rungs[0]` — rules out a single global rung cursor across agents.
- **Outer advance trigger is quota-only** — no role-driven agent reorder —
  parity baseline is patch/plan + `shared-invocation.md`, **not** v1 prompt mode
  (where `model_config` can advance agents) — rules out claiming full v1
  combined `{agent, model}` chain parity.
- **`Model` carries `adapterModel` + `priceKey`** — `adapterModel` is passed
  to the agent CLI; `priceKey` names one adapter-specific row in
  `data/prices.json` `models` — rules out bare agent-name price lookup,
  multi-key maps on one logical model, and implicit key derivation in the
  schema doc (validation mechanics deferred).
- **Misconfigured `rungs[0]` hitting `model_config` is terminal** — remedy is
  rung reordering — rules out auto-advancing past a bad first rung.
- **CLI override requires both `--agent` and `--model`** — bypasses load
  validation and both loops for one invocation; no matching `(agent, role)`
  entry needed — rules out single-flag override and per-step config override;
  interim shipped surface is `--agents` CSV per `write-behavior.md`.
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

- Add `v2/docs/agent-model-config.md` as the canonical schema home (schema,
  validation matrix, flattening algorithm, consumption modes, terminal outcomes,
  price derivation, example profiles).
- Document types: `Agent`, `Model`, `ModelEscalation`, `ModelsByRole`,
  `AgentModelConfig` (field names, JSON shapes, relationships).
- Document storage split: harness-global role→model artifact beside
  `data/prices.json`; per-machine project `agents` only.
- Document outer agent loop (quota-only advance) and inner rung loop (ordered
  models per `(agent, role)`, quota-only advance).
- Document flat binding construction: outer `agents` × inner rungs per step,
  fresh per invocation, outer landing resets to `rungs[0]`.
- Document rung terminal outcomes (`model_config`, `error`) and inner exhaustion
  → outer fallback composition.
- Document load-time validation rules (complete matrix, `operator` optional at
  load, hard error on gap, empty `rungs`, duplicate `agents`).
- Document runtime ignore rule for data-file agents not in project `agents`.
- Document per-role rung consumption modes (full-list vs head-only `actuator`).
- Document CLI override: both `--agent` and `--model` required; interim
  `--agents` CSV per `write-behavior.md`; bypasses validation and both loops.
- Document price derivation: `Model.priceKey` → one `prices.json` row; cost
  projection from rung order and per-role invocation counts.
- Include at least one non-normative example operator profile sketch (include
  multi-rung escalation for a non-`actuator` role).
- Record the load-bearing decisions above in the doc ledger.
- Cross-link `v2/docs/role-resolution.md`, `v2/docs/shared-invocation.md`, and
  `data/prices.json`.
- Note `implement` collapses two v1 tiers under one role (footnoted; no full v1
  tier parity claim).

## Acceptance criteria

- [ ] `v2/docs/agent-model-config.md` exists and documents `Agent`, `Model`,
      `ModelEscalation`, `ModelsByRole`, and `AgentModelConfig` with JSON
      field names and relationships.
- [ ] The doc states role→model data is one harness-global artifact beside
      `data/prices.json`; per-machine project config holds only an ordered
      `agents` list (exact filename deferred to first consumer).
- [ ] The doc states agents present in the data file but not in project
      `agents` are ignored at runtime (not load errors).
- [ ] The doc states missing `(agent, role)` for any project-configured agent
      and any required role (closed `Role` union minus optional `operator`) is
      a hard load error (no skip, no fallback role).
- [ ] The doc states empty `rungs` and duplicate project `agents` entries are
      load errors.
- [ ] Load succeeds when `operator` bindings are absent; resolving `operator`
      before Phase 9 is a runtime error.
- [ ] The doc states inner rung escalation is an ordered list per
      `(agent, role)`, advances **only** on quota, and treats `model_config`
      and `error` as terminal at the current rung.
- [ ] Quota after the last inner rung on an agent advances the outer agent
      loop for the same role, starting at the next agent's `rungs[0]`.
- [ ] Head-only `actuator` quota advances the outer agent loop only (no inner
      walk beyond `rungs[0]`).
- [ ] The doc documents full-list rung consumption for `plan`, `implement`,
      `adversary`, `advocate`, and `adjudicator`, and head-only consumption
      for `actuator`.
- [ ] The doc documents flat binding construction (outer `agents` × inner rungs,
      fresh per step invocation, outer landing resets to `rungs[0]`) and
      cross-links `v2/docs/shared-invocation.md` for terminal outcomes.
- [ ] The doc documents CLI override: both `--agent` and `--model` required;
      bypasses load validation and both loops for one invocation with no
      matching `(agent, role)` entry; notes interim `--agents` CSV per
      `write-behavior.md`.
- [ ] The doc documents `Model.priceKey` as one adapter-specific row in
      `data/prices.json` and how rung order plus role invocation counts
      support cost projection.
- [ ] The doc states misconfigured `rungs[0]` hitting `model_config` is
      terminal; remedy is rung reordering.
- [ ] The doc includes at least one non-normative example operator profile
      sketch with multi-rung escalation for a non-`actuator` role.
- [ ] The doc records load-bearing decisions in a ledger and cross-links
      `v2/docs/role-resolution.md`.
- [ ] No thinking/reviewing/executing category appears as a model-resolution
      key in `agent-model-config.md`. (Manual)

## Documentation updates

- `v2/docs/agent-model-config.md` (new) — canonical schema, validation rules,
  flattening algorithm, consumption modes, terminal outcomes, price
  derivation, example profiles, decisions ledger.
