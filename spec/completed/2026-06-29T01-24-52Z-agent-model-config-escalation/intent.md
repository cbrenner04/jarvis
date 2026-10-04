---
name: agent-model-config-escalation
---

# Agent model config and per-role escalation

Document v2's two-axis resolution: outer per-machine **agent quota-fallback** and inner per-agent **model rung escalation** keyed by role. Ship the canonical `AgentModelConfig` schema, validation rules, and price derivation from `data/prices.json`.

Design-only slice — no config store or resolver implementation (Phase 5).

## Scope

- Document `Agent`, `Model`, `ModelEscalation`, `ModelsByRole`, and `AgentModelConfig` types.
- Document outer agent loop (unchanged quota-fallback semantics) and inner rung loop (ordered models per `(agent, role)`, advance **only on quota**).
- Document terminal rung outcomes: `model_config` and `error` do not advance.
- Place per-machine `agents` in `~/.jarvis` project config; place per-agent role→model assignments in a machine-independent data file beside `data/prices.json`.
- Document missing `(agent, role)` as hard error at load (no skip, no fallback role).
- Document price estimates: each `Model` maps to a `data/prices.json` key per adapter; escalation rung order plus role invocation counts enable cost projection.
- Include at least one example operator profile sketch (non-normative).
- Pin remaining open config decisions below.
- Document outer/inner loop composition in `v2/docs/v2-architecture.md`.

## Out of scope

- Implementing load, validation, or resolution code.
- Quota/subscription budget caps (follow-on seed).
- v1 migration or dual-write.
- Workflow presets, TUI, concurrency admission.

## Decisions

- **`ModelEscalation` is an ordered rung list, not an unordered pool** — harness tries `rungs[0]`, then `rungs[1]`, … only on quota — rules out treating `Model[]` as a pool and rules out config-defined non-quota escalation triggers.
- **Role model assignments live beside `data/prices.json`** — version-controlled, machine-independent — rules out storing role→model maps in `config.json`.
- **Agent order is agents only** — per-machine outer loop — rules out reintroducing v1's combined `{agent, model}` list.
- **Missing `(agent, role)` is hard error at load** — rules out skip-with-fallback-role.
- **CLI `--agent` / `--model` bypasses resolution for one invocation** — document interaction with role config — rules out per-step config override.
- **Deferred to first consumer: exact `Model` validation strategy** — pin adapter-catalog + `prices.json` key validation when Phase 5 implements load — rules out guessing validation mechanics ahead of the resolver consumer.

## Documentation updates

- `v2/docs/agent-model-config.md` (new) — canonical schema, validation rules, price derivation, example profiles.
- `v2/docs/v2-architecture.md` — document outer agent loop + inner rung escalation; cross-link `agent-model-config.md`.

## Prerequisites

- Role keys are documented as v2 invocation-resolution keys (replacing thinking/reviewing/executing categories).
