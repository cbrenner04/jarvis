# 00 - Build flat role/model bindings

Given a workflow step role, ordered outer `agents`, and loaded
`AgentModelConfig`, build the flat ordered binding list
`shared/invocation/execute.ts` consumes.

## Decisions

- Resolver input is `(role, agents, AgentModelConfig)` plus a binding-construction seam for one `(agent, model)` pair; rules out reading project config or disk inside resolution.
- Resolver output is one flat ordered binding list in shared-executor attempt order; rules out embedding a second nested fallback loop beside `executeWithQuotaFallback`.
- `plan`, `implement`, `adversary`, `advocate`, and `adjudicator` append every rung in order for each landed agent; rules out head-only treatment outside `actuator`.
- `actuator` appends only `rungs[0]` for each landed agent; rules out same-agent actuator rung escalation on quota.
- Each agent contributes bindings starting from its own `rungs[0]`; rules out carrying a rung cursor across agents.
- The resolution path preserves shared invocation's quota-only advance contract; rules out binding-level `shouldAdvance` overrides that treat `model_config` or `error` as fallback signals.
- Missing or malformed `(agent, role)` data remains a load-time failure owned by `loadAgentModelConfig`; rules out resolver-time skip/mutate fallback around bad config.
- Resolver API, tests, and docs use role names only; rules out `thinking` / `reviewing` / `executing` category lookup in this path.
- Deferred to first consumer: workflow-step role plumbing from today's opaque `WorkflowStep.role` string into the closed role union — pin when a caller outside tests constructs real step roles.

## Task checklist

- [ ] Add a resolver that converts `(role, agents, AgentModelConfig)` into the flat ordered `InvocationBinding[]` list shared execution consumes.
- [ ] Update the binding-construction seam so one binding is built from one resolved `(agent, adapterModel, priceKey)` rung, not just a bare agent id.
- [ ] Cover full-list roles, head-only `actuator`, per-agent rung reset, and terminal `model_config` / `error` stop behavior with targeted tests.
- [ ] Export or share the closed v2 role contract at the resolver boundary instead of reintroducing ad hoc category keys.

## Acceptance criteria

- [ ] A resolver-focused test shows `implement` with `agents = [claude, codex]` and rungs `[M1, M2]` / `[M3]` yields shared-executor binding order `claude/M1 → claude/M2 → codex/M3`.
- [ ] A resolver-focused test shows `actuator` with the same per-agent rung lists yields `claude/M1 → codex/M1` and never includes non-head actuator rungs.
- [ ] A shared-execution test or source anchor shows resolver-produced bindings keep quota-only fallback semantics: `shared/invocation/execute.test.ts` stays green and the resolver path does not advance on `model_config` or `error`.
- [ ] A test shows quota after the last rung for one agent lands on the next agent's `rungs[0]`, proving there is no global rung cursor across agents.
- [ ] The binding-construction seam exposes one resolved binding per `(agent, adapterModel, priceKey)` rung rather than one binding per bare agent id.
- [ ] `v2/docs/agent-model-config.md` names the concrete resolver/binding-construction home for flat binding construction instead of describing it as an abstract algorithm only.
- [ ] `v2/docs/shared-invocation.md` documents that shared execution consumes ordered bindings already flattened from role + agent + rung resolution and that non-`quota` results remain terminal.
- [ ] No `thinking`, `reviewing`, or `executing` category appears in the resolver API or the edited durable docs for this path. (Manual)

## Documentation updates

- Update `v2/docs/agent-model-config.md` with the concrete resolver/binding-construction home and keep the flat-binding algorithm, per-role consumption, and terminal-outcome rules aligned with code.
- Update `v2/docs/shared-invocation.md` so the bindings seam describes resolved `(agent, model)` bindings rather than bare agent-id fallback only.
