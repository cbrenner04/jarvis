# Wire Claude Binding

`shared/invocation/agents.ts` still returns terminal unwired errors for resolved production bindings. Wire the `claude` resolved binding to spawn the real Claude CLI, while preserving shared invocation's flat binding and quota-only fallback contract.

## Decisions

- Port spawn/quota code into `shared/`; do not import `v1/**` from `shared/**`, because shared must stay version-agnostic.
- Wire only `agentId === "claude"`; do not add codex/cursor/opencode behavior in this slice, because their adapter contracts are separate review units.
- Keep `createResolvedAgentBinding`'s `agentId/adapterModel/priceKey` binding id and metadata; do not replace them with CLI-derived labels, because telemetry and rung identity already depend on the resolved config tuple.
- Classify Claude inside the binding's `invoke`; do not introduce v1 patch's separable `spawn`/`classify` seam, because shared invocation needs a settled `ok | quota | model_config | error` result before fallback.
- Deferred to first consumer: parsed Claude token/cost propagation through shared `InvocationResult` — pin when a v2 caller consumes non-null usage/cost from shared invocation.

## Tasks

- Add shared subprocess spawn support by porting the v1 agent-agnostic lifecycle behavior needed by Claude.
- Add shared quota/model-config classification support for Claude.
- Make resolved Claude bindings run `claude -p --permission-mode acceptEdits --model <adapterModel> --output-format json` with the prompt on stdin.
- Preserve unwired terminal-error behavior for unrecognized agents.
- Cover Claude success, quota, model_config, generic error, abort, binding metadata, and unwired-agent behavior with tests.
- Update durable docs for shared invocation and v1 parity notes.

## Documentation updates

- Update `v2/docs/shared-invocation.md` to say resolved Claude bindings spawn the real CLI and classify settled results.
- Update `v2/docs/v1-behaviors.md` if the shared port diverges from or narrows the v1 spawn/quota behavior.

## Acceptance criteria

- [ ] A resolved `claude` binding invokes the real Claude CLI command shape with `adapterModel`, stdin prompt delivery, caller `cwd`, and abort signal handling.
- [ ] Claude binding results classify as `ok`, `quota`, `model_config`, or `error` using the ported v1 subprocess and quota semantics.
- [ ] Unrecognized resolved agents still return the existing terminal unwired `error` result and keep metadata.
- [ ] `shared/invocation/execute.test.ts` fallback and telemetry tests stay green.
- [ ] `shared/invocation/agents.test.ts` covers the Claude binding and unwired-agent behavior.
- [ ] `v2/docs/shared-invocation.md` and, when needed, `v2/docs/v1-behaviors.md` describe the landed behavior without duplicating implementation detail.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` are green.
