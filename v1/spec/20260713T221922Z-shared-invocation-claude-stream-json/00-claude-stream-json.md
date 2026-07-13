# 00 - Shared claude binding spawns stream-json and parses the terminal result event

`shared/invocation/agents.ts` spawns claude with `--output-format json`: a single
batch envelope delivered at exit. Two consequences: the invocation's stdout is
invisible until the process ends, and `shared/invocation/claude-json.ts`'s
whole-stdout `JSON.parse` cannot read a stream. v1 fixed this in
`v1/src/agents/claude.ts:68` (`--output-format stream-json --verbose`) with a
terminal-`result`-event parser in `v1/src/agents/claude-json.ts`; `shared/` never
got it.

This subspec is the port. It makes claude usage/cost available on `InvocationOk`;
subspec 01 gets it into telemetry.

## Decisions

- Spawn `--output-format stream-json --verbose`; parse the **last** `type: "result"`
  NDJSON line for `result`, `usage`, `total_cost_usd`. Rules out keeping `json` and
  tailing stdout separately — one flag plus one parser covers both harms.
- Port `findTerminalResultEvent` from `v1/src/agents/claude-json.ts` rather than
  re-derive the envelope shape. Keep its whole-stdout fallback (a bare `result`
  object still parses) so a future CLI flag flip is not a silent regression.
- `isClaudeZeroExitQuotaEnvelope` reads the same terminal result event. Rules out
  leaving it on whole-stdout `JSON.parse`, which would silently stop detecting
  exit-0 quota under stream-json and let a quota-exhausted claude land as `ok`.
- Keep `shared/invocation/claude-json.ts` self-contained (its own quota patterns,
  its own usage type). `shared/**` must not import from `v1/**`.

## Acceptance criteria

- [x] A resolved `claude` binding spawns the CLI with `--output-format stream-json --verbose`.
- [x] A stream-json stdout (assistant events followed by a terminal `type: "result"` event) yields `kind: "ok"` with the result event's text as `stdout`, and non-null `usage` (`usage_source: "agent"`) and `cost_usd` (`cost_source: "agent"`).
- [x] Stdout carrying no `result` event yields `kind: "ok"` with raw stdout as display text, null usage/cost, and a warning naming the missing terminal result event.
- [x] A stream-json run whose terminal `result` event is a verified quota envelope (`is_error: true`, `api_error_status: 429`, quota message) settles `kind: "quota"` with the stdout preserved in `stderr`, not `ok`.
- [x] Existing `shared/invocation/agents.test.ts` and `claude-json.test.ts` cases for codex, cursor, quota/model_config/transient classification stay green (classification is unchanged by this port).

## Documentation updates

- `v2/docs/shared-invocation.md` — the bindings section states `--output-format json`; correct it to the stream-json spawn and terminal-result parse.
- `v2/docs/v1-behaviors.md` — record that the shared claude adapter now matches the v1 adapter's spawn and parse contract.
- `v2/docs/operator-runbook.md` — the "Choosing an actuator" claim that claude is safe as primary rests on v1's watchdog. State that shared/v2 claude now streams output, and that v2 still has no idle-output watchdog (only `iterationTimeoutMs` in `v2/src/execution/write-loop.ts`), so the escalation half of that claim does not yet hold for v2.
