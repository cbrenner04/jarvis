# Routing execution audit

## Problem

Free-text routing invokes a model and may reach daemon admission; operators need a durable, grep-friendly record of what was requested and what dispatched, and a clear rule when transport fails after an uncertain admission outcome.

## Decisions

- Each `runFreeTextRouting` invocation appends one JSON line to `~/.jarvis/routing-audit.jsonl` (`appendFile`, create-if-missing): `at` (ISO-8601), `operatorSessionId`, `requestSha256` (hex of normalized joined body), `requestLength`, `outcome` (`routing-rejected` | `routing-failed` | `validation-rejected` | `resolution-rejected` | `dispatched`), optional `action`, optional `dispatchExitCode`, optional `reason` — rules out stderr-only audit and rules out storing the full request text (paths and secrets stay out of the log).
- Audit write failures are non-fatal: log a single stderr warning and still return the routing/dispatch exit code — rules out failing the operator command because the audit file is unwritable.
- Free-text dispatch performs at most one daemon RPC per invocation (no client-side retry loop on `rpc-transport-failure` / `connection-lifecycle-failure`); a transport-class admission failure records `outcome: "dispatched"` with the failure detail in `reason` and returns the same exit code as explicit CLI — rules out automatic duplicate `pipeline_start` on retry inside one process.
- Re-running the same natural-language sentence in a later invocation is a new admission attempt (no cross-invocation dedupe by `requestSha256`); operator-runbook text tells the operator to confirm daemon state after transport failures before repeating — rules out silent dedupe that could hide a succeeded first attempt or block intentional restarts.

## Tasks

- Implement audit append helper in `free-text-routing.ts` (or a colocated `free-text-routing-audit.ts` if the orchestrator grows); call it once on every exit path after outcome is known.
- Extend `free-text-routing.test.ts` with a temp-home fixture asserting one JSONL line per call and fields for a validation failure vs a mocked successful dispatch; assert no second RPC when admission returns `rpc-transport-failure`.
- Add audit and transport-retry semantics to `v2/docs/operator-runbook.md` (short subsection under free-text routing).

## Acceptance criteria

- [x] `free-text-routing.test.ts`: after a validation rejection and after a mocked successful `pipeline.start` dispatch, exactly one audit line each is appended with matching `outcome` and `operatorSessionId`; fails against pre-audit code.
- [x] Same file: when injected admission settles `rpc-transport-failure`, exactly one `pipeline_start` RPC is attempted and the audit line records `dispatched` with a transport reason; fails against pre-audit code.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `routing-audit.jsonl` fields, transport-failure retry guidance, no cross-invocation dedupe.
