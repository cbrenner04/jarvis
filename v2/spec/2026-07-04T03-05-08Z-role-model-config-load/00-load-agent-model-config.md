# Load `AgentModelConfig` with load-time validation

Add a v2/src loader for the harness-global `AgentModelConfig` data file
(`(agent, role) → ModelEscalation`), per `v2/docs/agent-model-config.md`. No
workflow consumer calls this loader yet — this slice ships the load contract
only.

## Decisions

- On-disk filename: `data/agent-model-config.json` (repo-root `data/`, beside `prices.json`; global, not per-project) — first-consumer pin per `agent-model-config.md`.
- Loader input: parsed JSON value + the project's ordered `agents: readonly string[]` (same shape as `write-loop-input.ts`) — validation is scoped to those agents only.
- Required roles = closed `Role` union (`v2/docs/role-resolution.md`) minus `operator`.
- Missing `(agent, role)` for a required role on a project-configured agent → hard load error naming the agent and role.
- `operator` entry absent → not an error at load.
- `rungs` missing or empty for any present `(agent, role)` → hard load error naming the agent and role.
- Duplicate names in the `agents` input → hard load error (parity with `agent-model-config.md`'s load-time validation table).
- Agent present in the data file but absent from `agents` → ignored, no error.
- Malformed JSON / non-object top level / non-object per-agent value → hard load error.
- Deferred to first consumer: `Model.adapterModel`/`priceKey` existence checks against the adapter catalog and `prices.json` — this slice does not validate them.
- Deferred to first consumer: tier→initial rung index, capability-floor filtering.

## Task checklist

- [ ] Define `Model`, `ModelEscalation`, `ModelsByRole`, `AgentModelConfig` types matching `agent-model-config.md`.
- [ ] Implement a load function: given parsed JSON + `agents` list, returns the validated `AgentModelConfig` or throws/returns a typed error covering every hard-error rule above.
- [ ] Cover each hard-error rule and the two non-error cases (`operator` absent, extra agent ignored) with a co-located test file.

## Acceptance criteria

- [ ] Loading a config file where a project-configured agent is missing a required role fails with an error naming the agent and role.
- [ ] Loading a config file where a present `(agent, role)` has missing or empty `rungs` fails with an error naming the agent and role.
- [ ] Loading a config file that omits the `operator` role for every agent succeeds.
- [ ] Loading a config file containing an agent not present in the project's `agents` list succeeds and ignores that agent's entries.
- [ ] Duplicate names in the `agents` input fail load with an error.

## Documentation updates

- Update `v2/docs/agent-model-config.md`: replace the deferred "on-disk data filename" line under `## Decisions` with the pinned filename and a pointer to the loader module.
