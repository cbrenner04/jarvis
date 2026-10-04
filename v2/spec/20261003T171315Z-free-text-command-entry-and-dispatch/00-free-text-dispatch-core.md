# Free-text dispatch core

## Problem

`validateRoutingRequest` and `createRoutingAgentBinding` exist, but nothing turns an operator sentence into a catalog-validated action, resolves project/path/ID preconditions deterministically, and calls the same admission helpers as explicit CLI handlers.

## Decisions

- `runFreeTextRouting` (exported from `v2/src/commands/free-text-routing.ts`) is the single orchestration entry for tests and CLI: prompt assembly → `resolveRoutingBindings` + quota fallback → `parseRoutingOutput` → `validateRoutingRequest` → deterministic resolution → dispatch — rules out duplicating that chain in `cli.ts`.
- The routing prompt is a committed template under `shared/prompts/` listing `ROUTING_ACTION_CATALOG` field names, required vs optional args, and “emit exactly one JSON object, no prose”; the dispatcher injects operator `cwd` and the joined request text only — rules out ad-hoc per-call prompt strings in `cli.ts` or tool grants beyond the catalog text.
- Model output is untrusted through the full chain: routing `routingFailure` (`timeout`, `tool_call`, `malformed_output`), `RoutingRefusalError`, quota exhaustion with no eligible vendor, `validateRoutingRequest` rejection, and named resolution failures each return exit `1`, stderr with a stable `free-text-routing:` prefix and a machine-readable reason, and perform no daemon RPC — rules out partial dispatch, clarification prompts, or swallowing admission failures behind a second model pass.
- `pipeline.start` maps `seedPath` to `admitPipelineStart({ projectKey, seedPath })` with file read semantics identical to `jarvis pipeline start --seed` (path resolved from `cwd`, project registry, and optional `project` catalog field); omitted `project` uses `findProjectMatch(cwd, registry)` and refuses when unregistered — rules out `seedText` inference from path content, config overrides, or a second model interpretation of admission stderr/stdout.
- Every other catalog action dispatches through the same typed helper the explicit command uses today (`pipeline.approve`/`reject`/`resume`, `run.kill`/`resume`/`log`) with injected `CliDeps`; successful dispatch returns that helper's exit code and streams unchanged — rules out re-wrapping daemon results in NL or inventing aliases (`restart` → `resume`).
- Ambiguity is refusal, not disambiguation: unknown action, schema violation, unregistered project, missing seed file, invalid pipeline/run ID shape, or pre-admission refusal from the canonical admission API each error before daemon connect (or without mutating state when admission never connected); tests assert no `pipeline_start` / run RPC mock calls on those paths — rules out interactive pick-lists or “best guess” project selection beyond `findProjectMatch`.
- Deferred to first consumer: exact stderr wording for each resolution kind beyond the shared prefix — pin when operator-runbook documents the matrix in subspec 01.

## Tasks

- Add `shared/prompts/routing-translate.ts` (or equivalent) plus registry wiring if required by existing prompt loaders; keep the catalog excerpt generated from `ROUTING_ACTION_CATALOG` or duplicated once with a test that they stay aligned.
- Implement `free-text-routing.ts`: deps injection for routing invocation, registry reads, and per-action dispatch; map validation rejections and resolution errors to stable reason tokens.
- Add `v2/src/commands/free-text-routing.test.ts` with injected routing stdout and admission/daemon mocks: happy-path `pipeline.start` parity with `admitPipelineStart` inputs; failure matrix (unknown action, extra field, missing field, bad types, command-payload, tool_call, malformed_output, timeout, unregistered project, bad seed path, unsupported sentence → unknown-action or validation failure); assert zero RPC on failures.

## Acceptance criteria

- [x] `free-text-routing.test.ts`: a supported pipeline-start sentence reaches `admitPipelineStart` with the same `projectKey`/`seedPath` inputs and admission result as the explicit `pipeline start --seed` path under identical injected deps; fails against current code (no module).
- [x] Same file: ambiguity, missing or invalid targets, unsupported actions, schema violations, simulated tool execution (`routingFailure: "tool_call"`), and model failure (`malformed_output` / `timeout`) each exit `1` with no daemon RPC recorded on mocks; fails against current code.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None (operator-facing syntax lands in subspec 01; architecture already describes the validation boundary in `v2/docs/v2-architecture.md`).
