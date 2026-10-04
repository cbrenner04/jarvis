# Add critic role resolution

Add `critic` as an executable role with independent model escalation.

## Decisions

- `critic` is distinct from `adversary`; rules out sharing `(agent, adversary)` rungs across review primitives because the prompts and cost choices are independently configurable.
- `critic` is required for every configured executable agent; rules out accepting configs that fail only when a review step runs.
- `critic` uses full-list rung consumption; rules out actuator-style head-only consumption, so quota walks later critic rungs on the same agent before the next agent.
- Migrate every committed machine profile in the same change; rules out making existing `home` or `work` profiles unloadable under eager validation.

## Tasks

- Extend the closed executable-role taxonomy, eager config validation, and full-list binding resolution with `critic`.
- Add `critic` rungs to every agent in `config/machines/home.json` and `config/machines/work.json`.
- Add co-located config, profile-load, and resolution tests for mandatory critic config, committed-profile compatibility, independent critic/adversary bindings, and same-agent rung order.
- Update the taxonomy/mapping in `v2/docs/role-resolution.md` and schema/validation/consumption in `v2/docs/agent-model-config.md`.

## Acceptance criteria

- [x] Valid agent-model config requires and accepts independent `critic` rungs for every configured agent.
- [x] Resolving `critic` walks all same-agent critic rungs in order before advancing agents on quota, without reading `adversary` bindings.
- [x] The committed `home` and `work` profiles load with critic bindings for every cataloged agent.
- [x] Co-located tests cover missing critic config, committed-profile loading, distinct critic/adversary models, and same-agent critic quota fallback.
- [x] `v2/docs/role-resolution.md` lists `critic` and maps it to `review` while retaining `actuator` for verdict application.
- [x] `v2/docs/agent-model-config.md` makes `critic` globally required and documents its schema and full-list consumption.

## Documentation updates

- `v2/docs/role-resolution.md` — add the executable role and `review` mappings.
- `v2/docs/agent-model-config.md` — add `critic` schema, eager validation, and rung consumption.
