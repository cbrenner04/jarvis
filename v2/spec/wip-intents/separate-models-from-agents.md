---
name: separate-models-from-agents
---

# Intent: design v2 to separate model selection from the agent fallback order

Bake an agents-vs-models separation into the **v2 design docs and build-out
plan**. v1 today conflates the two: each `modes.{patch,plan}.agentOrder` entry
is `{ agent, model }`, so the agent fallback hierarchy and the model choice are
one combined list, one model per agent per mode. There is no v2 implementation
yet, so the work here is to update v2 docs and the build order so the new config
is designed right from the start — not to migrate v1.

## Why

- The hierarchy exists for **agents**, not models. `claude → codex → cursor →
  aider` is a preference-then-fallback chain: try the preferred agent, fall to
  the next when it's unavailable / quota-exhausted. That ordering is purely
  about agent availability.
- **Models** are a separate axis. They can't be a free global list because they
  attach to a specific agent — `codex` can't serve a Claude model, `cursor`
  can't serve a GPT model. So a model is always "this agent's model for X."
- v1 has exactly one model per agent per mode. There's no way to say "use the
  agent's heavyweight model for thinking-heavy work and its cheap model for
  routine execution" without inventing a whole new mode.
- v2 config is greenfield. Designing this separation now — in the docs and
  build plan — avoids inheriting v1's combined list and avoids a later config
  migration.

## Desired outcome

The v2 design docs and build-out plan describe two orthogonal config concepts:

1. **Agent fallback order** — a single ordered list of agents
   (`claude → codex → cursor → aider`), defined once. This is the availability
   chain.
2. **Model categories** — models grouped by the *kind of work* they're for, each
   category mapping (per agent) to the model that agent uses for that work.

A run step/phase names a **category**, not a model. The runner walks the agent
fallback order; for whichever agent it lands on, it uses that agent's model for
the requested category.

This is documentation + planning work. No v1 or v2 source changes here — it sets
up the phase(s) that will later implement v2 config to do it correctly.

## Categories

Exactly three. Treat these as the only categories that exist; the code is built
so more *could* be added later, but the set is not up for debate here.

- **thinking** — heavyweight reasoning: plan drafting/refinement, hard design.
- **reviewing** — critique passes: plan review, the patch review loop.
- **executing** — routine implementation: the write/patch loop's per-task work.

## Shape to document in v2

The two axes live in **different places**, because they have different
lifecycles:

- **Agents → per-machine config** (`~/.jarvis/config.json`). The agent fallback
  order genuinely differs between machines (different agents installed/licensed
  on the personal vs. work machine), so it belongs in machine-local config.
  ```
  "agents": ["claude", "codex", "cursor", "aider"]
  ```
- **Models → a separate, machine-independent store** — *not* `config.json`. The
  category→agent→model assignments are the same on every machine, change
  frequently, and would bloat per-machine config. Store them somewhere shared
  and version-controlled, easy to update (strawman: a checked-in data file
  alongside the global `data/prices.json`). Shape:
  ```
  "thinking":  { "claude": "opus",   "codex": "gpt-5.3-codex", "cursor": "...", "aider": "..." },
  "reviewing": { "claude": "sonnet", "codex": "gpt-5.3-codex", "cursor": "...", "aider": "..." },
  "executing": { "claude": "haiku",  "codex": "gpt-5.3-codex", "cursor": "...", "aider": "..." }
  ```
- **Exactly one model per (category, agent).** Every category × every configured
  agent must have a model defined; a missing assignment is a **hard error at
  load** — no skipping, no default fallback.
- Each run step declares the category it needs; the runner resolves
  `(agent-from-fallback-order, category) → model` from the model store.
- A **command-line override** (just `--agent` / `--model`, the override already
  being built for the single write step) bypasses the resolution for that run.
- Price/model validation still happens per agent+model pair, now per category.

## Scope (docs + plan)

- Update the relevant v2 docs to describe the agents-vs-models separation and
  the model-category model:
  - `v2/docs/v2-architecture.md` — config/runner model: agent fallback order
    (per-machine config) vs. the category→agent→model store (separate,
    machine-independent), and how a step resolves its model.
  - `v2/docs/v2-vision.md` — record the separation as an intended v2 capability.
  - `v2/docs/v2-build-order.md` — fold the config shape into whichever phase owns
    v2 config / per-step agent binding (today Phase 5, "project config binding /
    per-step agent bindings"); note quota-fallback interaction (Phase 1).
  - `v2/docs/v1-behaviors.md` — note that v1's combined `{agent, model}` order is
    intentionally *not* carried forward; v2 splits the axes.
- Update `v2/spec/v2-meta-index.md` if a phase line needs to mention the split.

## Decisions (locked)

- **Composition.** Agent order is the outer loop (availability); a category does
  not reorder agents. Once the agent is fixed, the category selects its single
  model. Exactly one model per (category, agent).
- **Step → category mapping.** write/patch loop = executing; plan draft/refine =
  thinking; review loops = reviewing.
- **Override.** The only override is a command-line `--agent` / `--model` pair
  (the one already being built for the single write step). No per-step config
  override.
- **Missing assignments.** Every category × agent must be defined; a gap is a
  hard error at load — no skip, no default.
- **Category set.** The three above are it. Code allows adding more later, but
  the set is fixed for this work.
- **Storage split.** Agents live in per-machine `config.json`; the
  category→agent→model assignments live in a separate machine-independent,
  version-controlled store.

## Open questions to resolve while drafting

- Exact home and format of the model store (e.g. a checked-in `data/` file
  beside `prices.json`) and how it's loaded/validated.
- Which build phase wires each piece (config-binding phase for the agent order;
  the write step for resolution + CLI override).

## Acceptance criteria (rough)

- v2 docs describe the agent fallback order (per-machine config) as separate
  from the category→agent→model store (machine-independent) — not one combined
  `{agent, model}` list, and models not in `config.json`.
- The docs fix the three categories (thinking/reviewing/executing), one model
  per (category, agent), with missing assignments a hard error at load.
- The docs explain how a run step resolves its model via
  `(agent fallback order, category)`, and that the only override is a CLI
  `--agent`/`--model` pair.
- `v2/docs/v2-build-order.md` (and `v2-meta-index.md` if needed) place the agent
  config and model store in concrete phases, so the eventual implementation
  inherits the separation rather than v1's combined list.
- The docs note the deliberate divergence from v1's combined order in
  `v2/docs/v1-behaviors.md`.

## Out of scope

- Implementing the config in v1 or v2 source — this is docs + build-plan only.
- Any v1 config migration; v1 keeps its combined `{agent, model}` order.
- Adding new agents or new models.
- Changing quota detection or the fallback *mechanism* (only what model each
  fallback step uses, once implemented).
- Cross-machine / cost-aggregation concerns.
