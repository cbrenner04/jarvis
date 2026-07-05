# 00 - Build flat role/model bindings

Given a workflow step role, ordered outer `agents`, and loaded
`AgentModelConfig`, build the flat ordered binding list
`shared/invocation/execute.ts` consumes.

## Decisions

- Resolver input is `(role, agents, AgentModelConfig)` plus a binding-construction seam for one `(agent, model)` pair; rules out reading project config or disk inside resolution.
- Resolver output is one flat ordered binding list in shared-executor attempt order; rules out embedding a second nested fallback loop beside `executeWithQuotaFallback`.
- Resolver boundary accepts the executable role subset `plan | implement | adversary | advocate | adjudicator | actuator`; rules out accepting the full documented role union and deciding `operator` consumption in this path before an executable caller exists.
- `plan`, `implement`, `adversary`, `advocate`, and `adjudicator` append every rung in order for each landed agent; rules out head-only treatment outside `actuator`.
- `actuator` appends only `rungs[0]` for each landed agent; rules out same-agent actuator rung escalation on quota.
- Each agent contributes bindings starting from its own `rungs[0]`; rules out carrying a rung cursor across agents.
- Empty `agents` resolves to `[]`, and the step path surfaces shared invocation's existing `no_binding` failure; rules out synthesizing a fallback binding or special-casing an empty resolver error.
- The resolution path preserves shared invocation's quota-only advance contract; rules out binding-level `shouldAdvance` overrides that treat `model_config` or `error` as fallback signals.
- Missing or malformed `(agent, role)` data remains a load-time failure owned by `loadAgentModelConfig`; rules out resolver-time skip/mutate fallback around bad config.
- Resolver API, tests, and docs use role names only; rules out `thinking` / `reviewing` / `executing` category lookup in this path.
- Deferred to first consumer: workflow-step role plumbing from today's opaque `WorkflowStep.role` string into the closed role union — pin when a caller outside tests constructs real step roles.

## Task checklist

- [ ] Add a resolver that converts `(role, agents, AgentModelConfig)` into the flat ordered `InvocationBinding[]` list shared execution consumes.
- [ ] Wire the live workflow-step execution path through that resolver so step roles reach shared invocation via resolver-produced flat bindings, not an unused helper.
- [ ] Update the binding-construction seam so one binding is built from one resolved `(agent, adapterModel, priceKey)` rung, not just a bare agent id.
- [ ] Cover full-list roles, head-only `actuator`, per-agent rung reset, terminal `model_config` / `error` stop behavior, and empty-`agents` handling with targeted tests.
- [ ] Export or share the executable v2 role contract at the resolver boundary and reject `operator` before this path instead of reintroducing ad hoc category keys.

## Acceptance criteria

- [x] A resolver-focused test shows `implement` with `agents = [claude, codex]` and rungs `[M1, M2]` / `[M3]` yields shared-executor binding order `claude/M1 → claude/M2 → codex/M3`.
- [x] A resolver-focused test covers `plan`, `adversary`, `advocate`, and `adjudicator` and shows each uses the same full-list per-agent rung consumption as `implement`.
- [x] A resolver-focused test shows `actuator` with the same per-agent rung lists yields `claude/M1 → codex/M1` and never includes non-head actuator rungs.
- [x] A workflow-step execution test shows a step with role `implement` reaches `shared/invocation/execute.ts` with resolver-produced bindings in `claude/M1 → claude/M2 → codex/M3` order, proving the production call site consumes the flattened list.
- [x] An execution-path test shows `quota` advances to the next resolver-produced binding, while `model_config` and `error` stop on the current binding and do not attempt the next agent or rung.
- [x] A test shows quota after the last rung for one agent lands on the next agent's `rungs[0]`, proving there is no global rung cursor across agents.
- [x] A workflow-step execution test shows `agents = []` produces shared invocation's `no_binding` outcome rather than a synthesized fallback or resolver-specific failure.
- [x] The binding-construction seam exposes one resolved binding per `(agent, adapterModel, priceKey)` rung rather than one binding per bare agent id.
- [x] A boundary test shows this resolver path accepts only executable roles and rejects `operator` rather than assigning it full-list or head-only consumption here.
- [x] `v2/docs/agent-model-config.md` names the concrete resolver/binding-construction home for flat binding construction instead of describing it as an abstract algorithm only.
- [x] `v2/docs/shared-invocation.md` documents that shared execution consumes ordered bindings already flattened from executable role + agent + rung resolution, returns `no_binding` for an empty binding list, and keeps non-`quota` results terminal.
- [ ] No `thinking`, `reviewing`, or `executing` category appears in the resolver API or the edited durable docs for this path. (Manual)

## Documentation updates

- Update `v2/docs/agent-model-config.md` with the concrete resolver/binding-construction home, the executable-role boundary for this path, the empty-`agents` outcome, and the flat-binding algorithm, per-role consumption, and terminal-outcome rules aligned with code.
- Update `v2/docs/shared-invocation.md` so the bindings seam describes resolved `(agent, model)` bindings rather than bare agent-id fallback only, and so `no_binding` on an empty resolved list remains explicit.
