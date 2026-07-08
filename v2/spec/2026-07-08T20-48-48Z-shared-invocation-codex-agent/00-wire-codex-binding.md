# Wire Codex Binding

`shared/invocation/agents.ts` now wires resolved `claude` bindings but still returns the unwired terminal stub for `codex`. Wire resolved Codex bindings to the real Codex CLI while preserving shared invocation's flat binding and quota-only fallback contract.

## Decisions

- Wire only `agentId === "codex"` in this slice; rules out adding cursor/opencode behavior.
- Reuse the existing shared spawn loop; rules out duplicating v1 `runAgent` in a Codex-only path.
- Port the v1 Codex CLI command shape, prompt marker, and session-usage lookup; rules out a new Codex adapter contract.
- Always pass `--model <adapterModel>` for resolved Codex bindings; rules out preserving v1's optional-model branch inside a required-model binding.
- Keep resolved binding id and metadata as `agentId/adapterModel/priceKey`; rules out deriving rung identity from Codex session files or CLI output.
- Classify Codex inside the binding's `invoke`; rules out returning raw subprocess exits for the step runner to reinterpret.
- Keep fallback advancement quota-only; rules out advancing to later rungs on `model_config`, generic `error`, abort, spawn failure, or missing session usage.
- Preserve the unwired terminal-error stub for non-Claude/non-Codex agents; rules out treating `cursor` as partially wired.
- Deferred to first consumer: shared propagation of Codex token/cost fields into non-null `invocation_completed` usage/cost columns — pin when a v2 caller requires billing-grade Codex usage.

## Tasks

- Add Codex as a supported `ResolvedAgentBinding` agent.
- Port the v1 Codex `exec` argv, stdin prompt delivery, invocation marker, session lookup, and quota/model-config/error classification behavior needed by shared invocation.
- Preserve shared abort, transient retry, spawn-failure, and fallback behavior.
- Cover Codex success, quota, model_config, generic error, abort-as-error, spawn-failure-as-error, session-usage unavailable success, telemetry metadata, and cursor/unrecognized-agent behavior with tests.
- Update durable docs for shared invocation and v1 parity notes.

## Documentation updates

- Update `v2/docs/shared-invocation.md` to say resolved Codex bindings spawn the real CLI and classify settled results.
- Update `v2/docs/v1-behaviors.md` only if the landed shared Codex command, classification, prompt marker, session lookup, usage/cost behavior, or retry behavior differs from v1 `codex.ts`/`codex-session.ts`/`spawn.ts`/`quota.ts`; otherwise no v1 parity edit is owed.

## Acceptance criteria

- [ ] A resolved `codex` binding invokes `codex exec --color never --sandbox workspace-write -c approval_policy="on-request" --model <adapterModel>`, pipes the augmented prompt on stdin, uses caller `cwd`, and honors abort signals.
- [ ] Codex binding results classify as `ok`, `quota`, `model_config`, or `error` using the shared subprocess lifecycle and ported v1 Codex/quota semantics, with aborts and spawn failures returning terminal `error`.
- [ ] A successful Codex invocation remains `ok` when Codex session usage cannot be resolved, while exposing the same unavailable-usage warning semantics as v1.
- [ ] A settled resolved `codex` invocation emits `invocation_completed` telemetry with real `codex` agent and resolved model metadata.
- [ ] Unrecognized resolved agents such as `cursor` still return the existing terminal unwired `error` result and keep metadata.
- [ ] `shared/invocation/execute.test.ts` fallback and telemetry tests stay green.
- [ ] `shared/invocation/agents.test.ts` covers the Codex binding, Codex classifications, session-usage unavailable success, telemetry metadata, and unwired-agent behavior.
- [ ] `v2/docs/shared-invocation.md` and, when needed, `v2/docs/v1-behaviors.md` describe the landed behavior without duplicating implementation detail.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` are green.
