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
| **Agent fallback order** | Top-level `agents` key in `~/.jarvis/config.json`, shape `{ "agents": string[] }` | Ordered `agents: Agent[]` — availability/quota chain only |
| **Role→model bindings** | Repo-committed per-profile file `config/machines/<profileName>.json`, loaded by [`machine-profile-loader.ts`](../src/config/machine-profile-loader.ts) | `AgentModelConfig` — `(agent, role) → ModelEscalation`; may catalog agents beyond any one project's `agents` list |

Two profiles are seeded: `home` (full claude+codex+cursor roster) and `work`
(codex+cursor only, no `claude`). Which profile a machine loads is resolved at
startup from the required `machineProfile` key in `~/.jarvis/config.json`
(`resolveMachineProfile`, [`machine-config-loader.ts`](../src/config/machine-config-loader.ts)).
A missing or empty `machineProfile` is a hard error; an existing key naming a
profile with no matching `config/machines/<profileName>.json` is also a hard
error. `machineProfile` is an open string — any non-empty value is accepted.

The machine agent order is edited with `jarvis config set-agents <agent,agent,...>` and inspected with `jarvis config show` / `jarvis config path` ([Read-only inspection](#read-only-inspection)).
`set-agents` replaces the full `agents` array, preserves unrelated top-level
keys in `~/.jarvis/config.json` (e.g. v1's `projects`, `machineProfile`), creates missing `~/.jarvis/` state on success, and
refuses to overwrite an existing file that is not a valid machine-config object.

Per-project variance is **only** the ordered `agents` list. Role→model assignments
are shared across machines and projects loading the same profile. Load validation
applies **only** to agents listed in the project's `agents` order — extra agents in
the loaded profile are ignored at load (see [Load-time validation](#load-time-validation)).
Workflow-source validation is separate: after config load succeeds, the loaded
workflow `steps` array must still resolve each step role for every
machine-configured agent before the workflow is allowed to run (see
[`workflow-runner.md`](workflow-runner.md)).

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
  "shrink": { "rungs": [ /* Model */ ] },
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
    "implement": { "rungs": [ /* … */ ] },
    "shrink": { "rungs": [ /* … */ ] }
  },
  "codex": {
    "plan": { "rungs": [ /* … */ ] },
    "implement": { "rungs": [ /* … */ ] },
    "shrink": { "rungs": [ /* … */ ] }
  }
}
```

**Relationships:** project config supplies `agents: Agent[]` (outer order).
`AgentModelConfig[agent][role]` supplies inner `rungs`. The current
`executeWorkflow` contract uses workflow-step `role` to validate that each
configured agent has its own binding entry before any run starts; it does not
rewrite a step's caller-supplied execution `bindings` from `role`. When a
consumer does flatten execution bindings from config, it walks `agents` and
reads `AgentModelConfig[agent][role].rungs` for each landed agent.

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

Per step invocation, build a fresh ordered binding list in
[`v2/src/config/agent-model-config.ts`](../src/config/agent-model-config.ts)
via `resolveInvocationBindings(...)`, using one-rung-at-a-time binding
construction from
[`shared/invocation/agents.ts`](../../shared/invocation/agents.ts)
`createResolvedAgentBinding(...)`. No rung cursor carries across invocations or
steps. The workflow boundary first rejects non-executable roles with
`resolveExecutableRole(...)`; `operator` does not enter this path.

**Algorithm** (given `agents`, `role`, and loaded `AgentModelConfig`):

1. Determine consumption mode for `role` ([below](#per-role-rung-consumption)).
2. For each `agent` in `agents` order:
   - Load `rungs = AgentModelConfig[agent][role].rungs`.
   - **Full-list:** append one binding per rung, in order.
   - **Head-only (`actuator`):** append only `rungs[0]`.
3. Build each appended binding from one resolved
   `(agentId, adapterModel, priceKey)` rung.
4. Pass the flat list to `execute`. Quota on binding *k* tries binding *k+1*.

Each outer landing resets to `rungs[0]` — there is no global rung index across
agents. Example with `agents = [claude, codex]`, `shrink` full-list,
`claude.shrink.rungs = [M1, M2]`, `codex.shrink.rungs = [M3]`:

```
claude/M1 → claude/M2 → codex/M3
```

Example with `actuator` head-only, same agents, each with `[M1, M2]` actuator
rungs (M2 is never tried on the same agent):

```
claude/M1 → codex/M1
```

Empty `agents` resolves to `[]`. Shared invocation then returns `no_binding`;
the resolver does not synthesize a fallback binding or a custom empty-list
error.

## Per-role rung consumption

| Role | Mode | Quota behavior on same agent |
| --- | --- | --- |
| `plan` | full-list | walk `rungs[0..n]` |
| `implement` | full-list | walk `rungs[0..n]` |
| `shrink` | full-list | walk `rungs[0..n]` |
| `adversary` | full-list | walk `rungs[0..n]` |
| `advocate` | full-list | walk `rungs[0..n]` |
| `adjudicator` | full-list | walk `rungs[0..n]` |
| `actuator` | head-only | only `rungs[0]`; quota advances outer agent loop |

Head-only `actuator` matches v1 `reviewActuator` verdict-tier semantics: inner
rungs beyond the head are not walked on quota for the same agent.

**Shrink footnote:** v2 model resolution has a dedicated `shrink` role with its
own rungs. `executeWorkflow` consumes those rungs for the hidden write-loop pass
after an `implement` write step returns `complete`.
Rung strength is config-author guidance only; load validation does not inspect
model names or prices as policy proxies.

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
| Required roles = closed `Role` union minus optional `operator`; includes `shrink` | — |
| `operator` entry absent | load succeeds; resolving `operator` before Phase 9 is a **runtime** error |
| `rungs` missing or empty for any present `(agent, role)` | hard error |
| Duplicate names in project `agents` | hard error |
| Agent present in data file but absent from project `agents` | **ignored at runtime** (not a load error) |
| Missing `(agent, role)` for a project-configured agent and required role | hard error — no skip, no fallback role, no silent default |

`Model` / `priceKey` existence checks against the adapter catalog and
`prices.json` are deferred to the first load consumer. Tier→initial rung index
and capability-floor filtering are deferred until a workflow consumer needs them.

Config load validates the config artifact itself. It does **not** prove that a
loaded workflow source is runnable: the workflow may still name a role absent
from the loaded config. `loadWorkflowSteps` (see
[`workflow-runner.md`](workflow-runner.md#loading-workflow-steps)) assembles
`agents`/`agentModelConfig` for a `WorkflowSourceStep[]` from the machine's
configured agent order and this data file, rejects any step naming
`role: "operator"` or a role outside the closed `Role` union, and runs the same
per-step role-resolution check once at load. `executeWorkflow` still separately
validates the loaded `steps` array against the current machine `agents` order
and loaded `AgentModelConfig` on every invocation (including resume), whether
or not steps came from `loadWorkflowSteps`; every step role must resolve for
every configured agent via an own `(agent, role)` entry. Inherited object
properties do not count. There is no deferred first-invocation fallback if a
later configured agent misses the role. After that gate, the current runner
still executes the step's supplied `bindings` unchanged.

## CLI override

**Target surface:** both `--agent` and `--model` are required together. That
pair bypasses load validation and both loops for one invocation. No matching
`(agent, role)` entry is needed.

**Interim shipped surface:** `jarvis write` / `jarvis run start` resolve their
ordered outer fallback list (agent IDs, no per-role models) from machine
config only — no CLI override. See [`write-behavior.md`](write-behavior.md).
This predates full `AgentModelConfig` resolution and does not implement inner
rungs or role-aware binding. `jarvis config set-agents <agent,agent,...>`
persists the outer list to `~/.jarvis/config.json`.

`set-agents` parses at the command boundary before any filesystem mutation:
empty CSV segments are rejected, and `agent:model` tokens are rejected because
the machine file stores agent order only. After that parse step, the landed
array reuses the machine-config loader contract: `agents` must be a non-empty,
string-only, duplicate-free array.

Precedence for the write/run-start commands: machine config `agents` when
present, else `DEFAULT_WRITE_AGENTS` (`["claude"]`).

Success stdout for `set-agents` is JSON with the landed order:
`{"agents":["claude","codex"]}`. Failures print one stderr line naming the
rejected input or invalid file state, exit non-zero, preserve prior file
content, and do not create `~/.jarvis/` or `config.json` when input is rejected
before the write path starts.

### Read-only inspection

`jarvis config show` — machine `agents` order only (not role→model or workflow config):
- configured `agents`: one name per line (exit 0)
- file absent or no `agents` key: `No machine agent override configured.` (exit 0)
- malformed JSON or validation failure: config-read error on stderr, exit non-zero

`jarvis config path` — expanded absolute machine-config path (exit 0).

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
    "shrink": {
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
    "shrink": {
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
For the hidden post-implement shrink pass: same full-list consumption as
`implement`, using `shrink` rungs.
For an `actuator` step: `claude/haiku → codex/gpt-5.4` — only each agent's
`rungs[0]`.

## Decisions

Load-bearing choices are in the sections above. Pins for first consumer:

- **On-disk data filename** — `config/machines/<profileName>.json` (repo-root `config/machines/`), one file per machine profile. Loader at [`v2/src/config/machine-profile-loader.ts`](../../v2/src/config/machine-profile-loader.ts), which delegates JSON-shape validation to `validateAgentModelConfig` in [`v2/src/config/agent-model-config.ts`](../../v2/src/config/agent-model-config.ts). Load validation is aggregate (not fail-fast): all hard-error violations are collected and reported together in one load result.
- **`Model` / `priceKey` validation** — adapter catalog + `prices.json` key existence.
- **Tier→initial rung index** — when a workflow consumer maps runnable `tier:` metadata.
- **Capability-floor filtering** — when Phase 5 wires v1 `actuationCapabilityFloor` parity.

No v1 migration or dual-write. v1 tier equivalence: [`role-resolution.md`](role-resolution.md) and the shrink footnote in [Per-role rung consumption](#per-role-rung-consumption).
