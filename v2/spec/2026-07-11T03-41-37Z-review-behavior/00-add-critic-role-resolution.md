# Add critic role resolution

Add `critic` as an executable role with independent model escalation.

## Decisions

- `critic` is distinct from `adversary`; rules out sharing `(agent, adversary)` rungs across review primitives because the prompts and cost choices are independently configurable.
- `critic` is required for every configured executable agent; rules out accepting configs that fail only when a review step runs.

## Tasks

- Extend the closed executable-role taxonomy, config validation, and binding resolution with `critic`.
- Add co-located config and resolution tests for critic validation, independent critic/adversary bindings, and critic rung order.
- Update the role taxonomy and behavior mapping in `v2/docs/role-resolution.md`.

## Acceptance criteria

- [ ] Valid agent-model config requires and accepts independent `critic` rungs for every configured agent.
- [ ] Resolving `critic` walks that role's configured rungs without reading `adversary` bindings.
- [ ] Config and resolution tests cover missing critic config and distinct critic/adversary models.
- [ ] `v2/docs/role-resolution.md` lists `critic` and maps it to `review` while retaining `actuator` for verdict application.

## Documentation updates

- `v2/docs/role-resolution.md` — add the executable role and `review` mappings.
