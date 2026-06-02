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

## Proposed categories

Starting set (open to refinement — suggestions invited):

- **thinking** — heavyweight reasoning: plan drafting/refinement, hard design.
- **reviewing** — critique passes: plan review, the patch review loop.
- **executing** — routine implementation: the write/patch loop's per-task work.

Alternatives to weigh: `planning` as its own category vs. folding it into
`thinking`; `drafting` vs `thinking`; whether `reviewing` and `thinking` ever
collapse. Keep the set small — every category multiplies per-agent config.

## Shape to document in v2

- A v2 config concept: a top-level `agents` fallback order plus a `models` map
  keyed by category, each category holding per-agent model assignments.
  Strawman:
  ```
  "agents": ["claude", "codex", "cursor", "aider"],
  "models": {
    "thinking":  { "claude": "opus",   "codex": "gpt-5.3-codex", ... },
    "reviewing": { "claude": "sonnet", "codex": "gpt-5.3-codex", ... },
    "executing": { "claude": "haiku",  "codex": "gpt-5.3-codex", ... }
  }
  ```
- Each run step declares the category it needs; the runner resolves
  `(agent-from-fallback-order, category) → model`.
- Price/model validation still happens per agent+model pair, now per category.

## Scope (docs + plan)

- Update the relevant v2 docs to describe the agents-vs-models separation and
  the model-category model:
  - `v2/docs/v2-architecture.md` — config/runner model: agent fallback order vs.
    model categories, and how a step resolves its model.
  - `v2/docs/v2-vision.md` — record the separation as an intended v2 capability.
  - `v2/docs/v2-build-order.md` — fold the config shape into whichever phase owns
    v2 config / per-step agent binding (today Phase 5, "project config binding /
    per-step agent bindings"); note quota-fallback interaction (Phase 1).
  - `v2/docs/v1-behaviors.md` — note that v1's combined `{agent, model}` order is
    intentionally *not* carried forward; v2 splits the axes.
- Update `v2/spec/v2-meta-index.md` if a phase line needs to mention the split.

## Open questions to resolve while drafting

- **Composition of the two axes.** Agent order is the outer loop (availability).
  Within a category, is model preference just "the chosen agent's model for this
  category," or can a category independently *re-order* which model/agent it
  prefers? Default: category does not reorder agents — agent order is global and
  authoritative; category only selects the model once the agent is fixed.
- **Step → category mapping.** Concretely: write/patch loop = executing; plan
  draft/refine = thinking; review loops = reviewing. Confirm and enumerate.
- **Per-mode/per-step override.** Is one global agent order enough, or do some
  steps need their own order? If overrides stay, where do they live.
- **Partial categories.** What if an agent has no model configured for a
  category — skip that agent for that category, fall back to a default, or hard
  error at load.
- **Category set is final?** Lock the names before any v2 config lands; renaming
  a category is a config break.
- **Which build phase owns it.** Confirm the config shape belongs in the config
  binding phase vs. earlier when quota fallback first needs a model.

## Acceptance criteria (rough)

- v2 docs describe a single agent fallback order separated from model
  assignments grouped by named categories — not one combined `{agent, model}`
  list.
- The docs explain how a run step resolves its model via
  `(agent fallback order, category)`.
- `v2/docs/v2-build-order.md` (and `v2-meta-index.md` if needed) place this
  config shape in a concrete phase, so the eventual implementation inherits the
  separation rather than v1's combined list.
- The docs note the deliberate divergence from v1's combined order in
  `v2/docs/v1-behaviors.md`.
- The category set and the two-axis composition rule are written down clearly
  enough that an implementer doesn't have to re-derive them.

## Out of scope

- Implementing the config in v1 or v2 source — this is docs + build-plan only.
- Any v1 config migration; v1 keeps its combined `{agent, model}` order.
- Adding new agents or new models.
- Changing quota detection or the fallback *mechanism* (only what model each
  fallback step uses, once implemented).
- Cross-machine / cost-aggregation concerns.
