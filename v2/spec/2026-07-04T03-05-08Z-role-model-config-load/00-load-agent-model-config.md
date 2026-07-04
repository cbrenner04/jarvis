# Load `AgentModelConfig` with load-time validation

Add a v2/src loader for the harness-global `AgentModelConfig` data file
(`(agent, role) → ModelEscalation`), per `v2/docs/agent-model-config.md`. No
workflow consumer calls this loader yet — this slice ships the load contract
only.

## Decisions

- On-disk filename: `data/agent-model-config.json` (repo-root `data/`, beside `prices.json`; global, not per-project) — first-consumer pin per `agent-model-config.md`.
- Loader module: `v2/src/config/agent-model-config.ts`.
- Loader input: resolved on-disk path (reads and JSON-parses `data/agent-model-config.json` itself) + the project's ordered `agents: readonly string[]` (same shape as `write-loop-input.ts`) — validation is scoped to those agents only.
- Error reporting: aggregate — the loader collects every hard-error violation across all agents/roles/rungs and returns them together, not fail-fast on the first one. The data file is hand-edited; one load report should surface every fix needed.
- Required roles = closed `Role` union (`v2/docs/role-resolution.md`) minus `operator`.
- Missing `(agent, role)` for a required role on a project-configured agent → hard error naming the agent and role.
- `operator` entry absent → not an error at load.
- `rungs` missing, empty, or not an array → hard error naming the agent and role.
- Each rung not an object, or missing/non-string `adapterModel` or `priceKey` → hard error naming the agent, role, and rung index.
- Duplicate names in the `agents` input → hard error (parity with `agent-model-config.md`'s load-time validation table).
- Empty `agents` list → vacuously valid; no required agents means nothing to check, load succeeds trivially.
- Agent present in the data file but absent from `agents` → ignored, no error.
- Unrecognized role key present in an agent's entry → ignored, no error (symmetric with "extra agent ignored"; avoids a typo'd role key surfacing as a confusing "missing role" error).
- Malformed JSON / non-object top level / non-object per-agent value → hard error.
- Deferred to first consumer: `Model.adapterModel`/`priceKey` existence checks against the adapter catalog and `prices.json` — this slice validates only shape (present, string), not existence.
- Deferred to first consumer: tier→initial rung index, capability-floor filtering.

## Task checklist

- [ ] Define `Model`, `ModelEscalation`, `ModelsByRole`, `AgentModelConfig` types matching `agent-model-config.md`.
- [ ] Implement a load function in `v2/src/config/agent-model-config.ts`: given the `agents` list, reads and parses `data/agent-model-config.json` from its resolved on-disk path, returns the validated `AgentModelConfig` or a typed aggregate error covering every hard-error rule above.
- [ ] Cover each hard-error rule and the non-error cases (`operator` absent, extra agent ignored, extra role key ignored, empty `agents` list) with a co-located test file.

## Acceptance criteria

- [ ] Loading a config file where a project-configured agent is missing a required role fails with an error naming the agent and role.
- [ ] Loading a config file where a present `(agent, role)` has missing, empty, or non-array `rungs` fails with an error naming the agent and role.
- [ ] Loading a config file where a rung is missing or has a non-string `adapterModel` or `priceKey` fails with an error naming the agent, role, and rung index.
- [ ] Loading a config file that omits the `operator` role for every agent succeeds.
- [ ] Loading a config file containing an agent not present in the project's `agents` list succeeds and ignores that agent's entries.
- [ ] Loading a config file containing an unrecognized role key for an agent succeeds and ignores that role entry.
- [ ] Duplicate names in the `agents` input fail load with an error.
- [ ] Loading with an empty `agents` list succeeds.
- [ ] Loading malformed JSON, a non-object top-level value, or a non-object per-agent value fails load with an error.
- [ ] Loading a config file with multiple independent violations (e.g. two different agents each missing a required role) reports all violations in one load result, not just the first.

## Documentation updates

- Update `v2/docs/agent-model-config.md`: replace the deferred "on-disk data filename" line under `## Decisions` with the pinned filename and a pointer to `v2/src/config/agent-model-config.ts`; note the aggregate (not fail-fast) error-reporting contract in the load-time validation section.
