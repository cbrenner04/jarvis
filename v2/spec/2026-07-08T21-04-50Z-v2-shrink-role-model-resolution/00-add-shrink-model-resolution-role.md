# Add shrink model-resolution role

`shrink` becomes its own v2 model-resolution role with required per-agent rungs.
It no longer shares `implement` rungs by taxonomy, while runtime invocation of
`role: shrink` remains out of scope.

## Decisions

- `shrink` is an executable role in the closed `Role` union; rules out leaving shrink as `implement` until a runtime caller exists.
- `shrink` is required at agent-model-config load time; rules out optional `operator`-style rollout and prevents profiles from validating before shrink rungs are authored.
- `shrink` consumes the full rung list; rules out actuator-style head-only fallback.
- `config/machines/*.json` author explicit `shrink` rungs for every agent with `implement`; rules out synthesizing shrink from implement at load time.
- Rung strength is documented as config-authoring guidance only; rules out validating model names or prices as a policy proxy.
- Runtime steps naming `role: shrink` remain out of scope for this subspec; rules out adding shrink workflow presets or changing post-completion shrink invocation now.

## Tasks

- Add `shrink` to the v2 role type/resolution surface and load-time required-role validation.
- Include `shrink` in full-list binding resolution tests and missing-role validation tests.
- Add `shrink` rungs to all committed machine profiles that define `implement`.
- Update durable docs in `v2/docs/role-resolution.md` and `v2/docs/agent-model-config.md`.

## Acceptance criteria

- [ ] Loading an agent model config for a configured agent without `shrink` fails with the same hard-error shape as other required roles.
- [ ] `resolveInvocationBindings("shrink", ...)` returns every shrink rung for each configured agent in order, unlike `actuator` which remains head-only.
- [ ] `config/machines/home.json` and `config/machines/work.json` define non-empty `shrink` rungs for every agent that defines `implement`.
- [ ] `v2/docs/role-resolution.md` documents `shrink` as a closed role separate from `implement`, with runtime shrink-step invocation still out of scope.
- [ ] `v2/docs/agent-model-config.md` documents `shrink` in schema examples, per-role consumption, and load-time required-role validation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/role-resolution.md`
- `v2/docs/agent-model-config.md`
