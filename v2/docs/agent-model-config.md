# Agent model config

Canonical home for the v2 `AgentModelConfig` schema, inner rung escalation,
load-time validation, flat binding construction, and price derivation. Role
taxonomy lives in [`role-resolution.md`](role-resolution.md); layered context in
[`v2-architecture.md`](v2-architecture.md). Invocation fallback semantics live in
[`shared-invocation.md`](shared-invocation.md). Price rows live in
[`data/prices.json`](../../data/prices.json).

## Storage split

Two axes, two stores:

| Axis | Store | Contents |
| --- | --- | --- |
| **Agent fallback order** | Per-machine `~/.jarvis/v2.json`, shape `{ "agents": string[] }` | Ordered `agents: Agent[]` — availability/quota chain only |
| **Role→model bindings** | One harness-global, version-controlled data file beside `data/prices.json` | `AgentModelConfig` — `(agent, role) → ModelEscalation`; may catalog agents beyond any one project's `agents` list |

Per-project variance is **only** the ordered `agents` list. Role→model assignments
are shared across machines and projects. Load validation applies **only** to
agents listed in the project's `agents` order — extra agents in the global file
are ignored at load (see [Load-time validation](#load-time-validation)). The
on-disk filename for the global data file is deferred to the first consumer that
implements load.

v1's combined `{agent, model}` `agentOrder` entries are retired. v2 holds agent
names in project config and model rungs in the global store.

## Types

Resolution keys are concrete **roles** from the closed union in
[`role-resolution.md`](role-resolution.md). This schema uses role names only.

### `Agent`

Harness agent identifier (adapter name). JSON: a string, e.g. `"claude"`,
`"codex"`, `"cursor"`, `"opencode"`.

### `Model`

One logical model binding for a single agent adapter.

```json
{
  "adapterModel": "claude-sonnet-4-6",
  "priceKey": "claude-sonnet-4-6"
}
```

| Field | Meaning |
| --- | --- |
| `adapterModel` | Passed to the agent CLI when this binding is invoked |
| `priceKey` | Names exactly one row in `data/prices.json` → `models` for cost lookup |

`adapterModel` and `priceKey` may differ when the adapter's CLI model string
does not match the canonical price row key (e.g. Cursor display names in
`prices.json`). Validation mechanics (adapter catalog, key existence) are
deferred to the first load consumer.

### `ModelEscalation`

Ordered inner rung list for one `(agent, role)` pair. Quota on rung *i* tries
rung *i+1* on the **same** agent before the outer loop advances.

```json
{
  "rungs": [
    { "adapterModel": "claude-sonnet-4-6", "priceKey": "claude-sonnet-4-6" },
    { "adapterModel": "claude-haiku-4-5-20251001", "priceKey": "claude-haiku-4-5-20251001" }
  ]
}
```

`rungs` is required, non-empty at load, and strictly ordered. Unordered pools and
config-defined non-quota escalation triggers are out of scope.

### `ModelsByRole`

Per-agent map from role to escalation list.

```json
{
  "plan": { "rungs": [ /* Model */ ] },
  "implement": { "rungs": [ /* Model */ ] },
  "adversary": { "rungs": [ /* Model */ ] },
  "advocate": { "rungs": [ /* Model */ ] },
  "adjudicator": { "rungs": [ /* Model */ ] },
  "actuator": { "rungs": [ /* Model */ ] }
}
```

`operator` may be absent until Phase 9 wires NL routing (see validation below).

### `AgentModelConfig`

Top-level harness-global artifact. Maps each agent name to its `ModelsByRole`.

```json
{
  "claude": {
    "plan": { "rungs": [ /* … */ ] },
    "implement": { "rungs": [ /* … */ ] }
  },
  "codex": {
    "plan": { "rungs": [ /* … */ ] },
    "implement": { "rungs": [ /* … */ ] }
  }
}
```

**Relationships:** project config supplies `agents: Agent[]` (outer order).
`AgentModelConfig[agent][role]` supplies inner `rungs`. At step invocation the
runner resolves `role` from the workflow step, walks `agents`, and for each
landed agent reads `AgentModelConfig[agent][role].rungs`.

## Two-axis resolution

### Outer agent loop

Walks the per-machine `agents` order. Advances **only** on `quota`. Role never
reorders agents. Parity baseline is v2 patch/plan + [`shared-invocation.md`](shared-invocation.md) — **not** v1 prompt mode, where `model_config` can advance agents.

### Inner rung loop

For each landed `(agent, role)`, walks that pair's ordered `rungs`. Advances
**only** on `quota`. No v1-style no-progress rung escalation at the model axis;
no-progress remains an outer-loop concern only if a future consumer adds it.

### Composed fallback

1. Try `agents[0]` at `rungs[0]` for the step's role.
2. **Quota** on the current rung → next inner rung on the same agent (consumption
   mode permitting).
3. **Quota** after the last inner rung on an agent → next agent at `rungs[0]`
   for the same role.
4. **`model_config` or `error`** → terminal immediately; no inner advance, no
   outer advance (see [Terminal outcomes](#terminal-outcomes)).
5. Exhaust all bindings → invocation failure.

Misconfigured `rungs[0]` that returns `model_config` is terminal. Remedy: reorder
rungs so a valid model is first — the harness does not auto-skip a bad head rung.

## Flat binding construction

Per step invocation, build a fresh ordered binding list for
[`shared/invocation/execute.ts`](../../shared/invocation/execute.ts). No rung
cursor carries across invocations or steps.

**Algorithm** (given `agents`, `role`, and loaded `AgentModelConfig`):

1. Determine consumption mode for `role` ([below](#per-role-rung-consumption)).
2. For each `agent` in `agents` order:
   - Load `rungs = AgentModelConfig[agent][role].rungs`.
   - **Full-list:** append one binding per rung, in order.
   - **Head-only (`actuator`):** append only `rungs[0]`.
3. Pass the flat list to `execute`. Quota on binding *k* tries binding *k+1*.

Each outer landing resets to `rungs[0]` — there is no global rung index across
agents. Example with `agents = [claude, codex]`, `implement` full-list,
`claude.implement.rungs = [M1, M2]`, `codex.implement.rungs = [M3]`:

```
claude/M1 → claude/M2 → codex/M3
```

Example with `actuator` head-only, same agents, each with `[M1, M2]` actuator
rungs (M2 is never tried on the same agent):

```
claude/M1 → codex/M1
```

## Per-role rung consumption

| Role | Mode | Quota behavior on same agent |
| --- | --- | --- |
| `plan` | full-list | walk `rungs[0..n]` |
| `implement` | full-list | walk `rungs[0..n]` |
| `adversary` | full-list | walk `rungs[0..n]` |
| `advocate` | full-list | walk `rungs[0..n]` |
| `adjudicator` | full-list | walk `rungs[0..n]` |
| `actuator` | head-only | only `rungs[0]`; quota advances outer agent loop |

Head-only `actuator` matches v1 `reviewActuator` verdict-tier semantics: inner
rungs beyond the head are not walked on quota for the same agent.

**v1 `implement` footnote:** v1 binds implementation loop (`patchActuator`) and
post-completion shrink (`reviewActuator`, full-list) to different configurable
tiers. v2 maps both workflow steps to role `implement` — one
`(agent, implement) → ModelEscalation` per agent. When those v1 tiers differ,
v2 cannot represent both independently without disambiguation beyond bare
`(agent, role)`. No full v1 tier parity claim through a single `implement` key.

## Terminal outcomes

Aligned with [`shared-invocation.md`](shared-invocation.md):

| Result | Inner advance | Outer advance |
| --- | --- | --- |
| `quota` | yes, if another binding follows in the flat list | yes, when the next binding is on a different agent |
| `quota` (last binding) | **no** | **no** — invocation failure |
| `model_config` | **no** | **no** |
| `error` | **no** | **no** |
| `ok` | stop (success) | — |

`quota` on the final flat binding is invocation failure (step 5 in
[Composed fallback](#composed-fallback)). Mid-chain `quota` walks the flat list.
`model_config` and `error` do not advance.

## Load-time validation

| Rule | On violation |
| --- | --- |
| Every `agent` in project `agents` has a `ModelsByRole` entry in the data file | hard error |
| For each such agent, every required role has a `ModelEscalation` entry | hard error |
| Required roles = closed `Role` union minus optional `operator` | — |
| `operator` entry absent | load succeeds; resolving `operator` before Phase 9 is a **runtime** error |
| `rungs` missing or empty for any present `(agent, role)` | hard error |
| Duplicate names in project `agents` | hard error |
| Agent present in data file but absent from project `agents` | **ignored at runtime** (not a load error) |
| Missing `(agent, role)` for a project-configured agent and required role | hard error — no skip, no fallback role, no silent default |

`Model` / `priceKey` existence checks against the adapter catalog and
`prices.json` are deferred to the first load consumer. Tier→initial rung index
and capability-floor filtering are deferred until a workflow consumer needs them.

## CLI override

**Target surface:** both `--agent` and `--model` are required together. That
pair bypasses load validation and both loops for one invocation. No matching
`(agent, role)` entry is needed.

**Interim shipped surface:** `jarvis write` / `jarvis run start` accept
`--agents <csv>` as the ordered outer fallback list only (agent IDs, no per-role
models). See [`write-behavior.md`](write-behavior.md). This predates full
`AgentModelConfig` resolution and does not implement inner rungs or role-aware
binding.

Precedence for the write/run-start commands: CLI `--agents` > machine config `agents` > `DEFAULT_WRITE_AGENTS` (`["claude"]`). When `--agents` is absent, the per-machine agent list from `~/.jarvis/v2.json` (if present) is used; otherwise the built-in default applies.

No single-flag override. No per-step config override.

## Price derivation

Each `Model.priceKey` selects one adapter-specific row in
[`data/prices.json`](../../data/prices.json) → `models`. Cost projection (deferred
to implementation) multiplies per-step invocation counts by the flat binding list
for that role ([flat binding construction](#flat-binding-construction)), looks up
each binding's `priceKey`, and weights by expected quota fallthrough — earlier
rungs are tried first, so not every rung fires every time.

## Example operator profile (non-normative)

Illustrative sketch — not a shipped default, **not load-valid as written** (each
project-configured agent needs every required role; excerpts show only the roles
relevant to the flat-binding examples below). Global data file (fragment):

```json
{
  "claude": {
    "implement": {
      "rungs": [
        { "adapterModel": "claude-sonnet-4-6", "priceKey": "claude-sonnet-4-6" },
        { "adapterModel": "claude-haiku-4-5-20251001", "priceKey": "claude-haiku-4-5-20251001" }
      ]
    },
    "actuator": {
      "rungs": [
        { "adapterModel": "claude-haiku-4-5-20251001", "priceKey": "claude-haiku-4-5-20251001" }
      ]
    }
  },
  "codex": {
    "implement": {
      "rungs": [
        { "adapterModel": "gpt-5.4", "priceKey": "gpt-5.4" }
      ]
    },
    "actuator": {
      "rungs": [
        { "adapterModel": "gpt-5.4", "priceKey": "gpt-5.4" }
      ]
    }
  }
}
```

Per-machine project config (excerpt):

```json
{
  "agents": ["claude", "codex"]
}
```

For an `implement` step: flat bindings =
`claude/sonnet → claude/haiku → codex/gpt-5.4`.
For an `actuator` step: `claude/haiku → codex/gpt-5.4` — only each agent's
`rungs[0]`.

## Decisions

Load-bearing choices are in the sections above. Pins for first consumer:

- **On-disk data filename** — when Phase 5 implements load.
- **`Model` / `priceKey` validation** — adapter catalog + `prices.json` key existence.
- **Tier→initial rung index** — when a workflow consumer maps runnable `tier:` metadata.
- **Capability-floor filtering** — when Phase 5 wires v1 `actuationCapabilityFloor` parity.

No v1 migration or dual-write. v1 tier equivalence: [`role-resolution.md`](role-resolution.md) and the `implement` footnote in [Per-role rung consumption](#per-role-rung-consumption).
