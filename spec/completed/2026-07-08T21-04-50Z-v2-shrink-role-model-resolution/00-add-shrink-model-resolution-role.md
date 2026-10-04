# Add shrink model-resolution role

`shrink` becomes its own v2 model-resolution role with required per-agent rungs.
It no longer shares `implement` rungs by taxonomy, while runtime invocation of
`role: shrink` remains out of scope.

## Decisions

- `shrink` is an executable role in the closed `Role` union; rules out leaving shrink as `implement` until a runtime caller exists.
- `shrink` is required by the same agent-scoped required-role rule as existing required roles; rules out implement-conditional or optional-operator-style rollout.
- `shrink` consumes the full rung list; rules out actuator-style head-only fallback.
- `config/machines/*.json` author explicit `shrink` rungs for every agent validated by the required-role rule; rules out synthesizing shrink from implement at load time.
- Role/type addition, load-time validation, and committed profile rungs land atomically in this subspec; rules out a migration sequence that makes config loading fail between PRs.
- Rung strength is documented as config-authoring guidance only; rules out validating model names or prices as a policy proxy.
- Runtime steps naming `role: shrink` remain out of scope for this subspec; rules out adding shrink workflow presets or changing post-completion shrink invocation now.
- Model-resolution `shrink` and `patch_phase: "shrink"` are separate namespaces; rules out treating telemetry phase values as `Role` members.

## Tasks

- Add `shrink` to the v2 role type/resolution surface and load-time required-role validation.
- Include `shrink` in full-list binding resolution tests and missing-role validation tests.
- Add `shrink` rungs to all committed machine profiles for every required-role-scoped agent.
- Update durable docs in `v2/docs/role-resolution.md` and `v2/docs/agent-model-config.md`.

## Acceptance criteria

- [x] `v2/src/config/agent-model-config.test.ts` and `v2/src/config/machine-profile-loader.test.ts` extend existing required-role missing-role coverage so a scoped agent without `shrink` fails with the same hard-error shape as other required roles.
- [x] `resolveInvocationBindings("shrink", ...)` returns every shrink rung for each configured agent in order, unlike `actuator` which remains head-only.
- [x] `config/machines/*.json` define non-empty `shrink` rungs for every agent scoped by required-role validation.
- [x] `v2/docs/role-resolution.md` documents `shrink` as a closed role separate from `implement`, notes that runtime shrink-step invocation remains out of scope, and disambiguates model-resolution `shrink` from `patch_phase: "shrink"`.
- [x] `v2/docs/agent-model-config.md` documents `shrink` in schema examples, per-role consumption, and load-time required-role validation.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/role-resolution.md`
- `v2/docs/agent-model-config.md`
