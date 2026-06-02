---
name: separate-models-from-agents
---

# Intent: separate model selection from the agent fallback order

Config currently conflates two different things in one structure. Each
`modes.{patch,plan}.agentOrder` entry is `{ agent, model }`, so the agent
fallback hierarchy and the model choice are baked together, one model per agent
per mode. Pull them apart.

## Why

- The hierarchy exists for **agents**, not models. `claude → codex → cursor →
  aider` is a preference-then-fallback chain: try the preferred agent, fall to
  the next when it's unavailable / quota-exhausted. That ordering is purely
  about agent availability.
- **Models** are a separate axis. They can't be a free global list because they
  attach to a specific agent — `codex` can't serve a Claude model, `cursor`
  can't serve a GPT model. So a model is always "this agent's model for X."
- Today there's exactly one model per agent per mode. There's no way to say
  "use the agent's heavyweight model for thinking-heavy work and its cheap model
  for routine execution" without inventing a whole new mode.

## Desired outcome

Two orthogonal config concepts:

1. **Agent fallback order** — a single ordered list of agents
   (`claude → codex → cursor → aider`), defined once. This is the availability
   chain.
2. **Model categories** — models grouped by the *kind of work* they're for, each
   category mapping (per agent) to the model that agent uses for that work.

A phase of a run names a **category**, not a model. The runner walks the agent
fallback order; for whichever agent it lands on, it uses that agent's model for
the requested category.

## Proposed categories

Starting set (open to refinement — the user explicitly invited suggestions):

- **thinking** — heavyweight reasoning: plan drafting/refinement, hard design.
- **reviewing** — critique passes: plan review, the proposed patch review loop.
- **executing** — routine implementation: the patch loop's per-task work.

Alternatives to weigh: `planning` as its own category vs. folding it into
`thinking`; `drafting` vs `thinking`; whether `reviewing` and `thinking` ever
collapse. Keep the set small — every category multiplies per-agent config.

## Rough shape

- New config concept (likely a config **version bump**, e.g. v3): a top-level
  `agents` fallback order plus a `models` map keyed by category, each category
  holding per-agent model assignments. Strawman:
  ```
  "agents": ["claude", "codex", "cursor", "aider"],
  "models": {
    "thinking":  { "claude": "opus",   "codex": "gpt-5.3-codex", ... },
    "reviewing": { "claude": "sonnet", "codex": "gpt-5.3-codex", ... },
    "executing": { "claude": "haiku",  "codex": "gpt-5.3-codex", ... }
  }
  ```
- Each run phase declares the category it needs; the runner resolves
  `(agent-from-fallback-order, category) → model`.
- Migration from the current v2 `modes.{patch,plan}.agentOrder` `{agent,model}`
  pairs, with a clear error/conversion message like the existing v1→v2 path.
- Price-key validation (`resolveAgentPriceKey`) still runs per
  agent+model pair, now per category.

## Open questions to resolve while drafting

- **Composition of the two axes.** Agent order is the outer loop (availability).
  Within a category, is model preference just "the chosen agent's model for this
  category," or can a category independently *re-order* which model/agent it
  prefers? Default: category does not reorder agents — agent order is global and
  authoritative; category only selects the model once the agent is fixed.
- **Phase → category mapping.** Concretely: patch loop = executing; plan
  draft/refine = thinking; plan review (and any patch review) = reviewing.
  Confirm and enumerate every phase.
- **Per-mode override.** Do patch and plan still need to differ in agent order,
  or is one global agent order enough now that models are categorized? If
  overrides stay, where do they live.
- **Partial categories.** What if an agent has no model configured for a
  category — skip that agent for that category, fall back to a default model, or
  hard error at load.
- **Category set is final?** Lock the names before implementation; renaming a
  category is a config break.
- **Config surface.** How `jarvis1 config` edits the new shape; whether
  defaults ship for all agents in all categories.

## Acceptance criteria (rough)

- Config separates a single agent fallback order from model assignments grouped
  by named categories; agents and models are no longer one combined list.
- Each run phase resolves its model via `(agent fallback order, category)`, not
  a hardcoded per-mode model.
- Agent fallback (preferred → next on unavailability/quota) is unchanged in
  behavior; only model resolution moves.
- Loading a current v2 config produces a clear, actionable migration error or
  conversion path (mirroring the existing v1→v2 handling).
- Per agent+model+category, price-key validation still rejects unknown priced
  models at load.
- Docs updated:
  - `v1/docs/config.md` — new config shape, categories, migration.
  - `v1/docs/agents.md` — agent fallback vs. model categories distinction.
  - `README.md` — config overview mention.

## Out of scope

- Adding new agents or new models.
- Changing quota detection or the fallback *mechanism* (only what model each
  fallback step uses).
- Per-task dynamic model selection beyond the fixed category-per-phase mapping.
- Cross-machine / cost-aggregation concerns.
