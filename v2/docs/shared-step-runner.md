# Shared step-runner contract

`v2/src/execution/step-runner.ts` owns the behavior-agnostic step execution seam above
`shared/invocation/execute.ts`.

Contract:

- Input: behavior prompt + ordered invocation bindings + deterministic contracts.
- Invocation is executed exactly once through shared quota fallback.
- Token parsing happens once in runner code and accepts only `done`, `no-work`,
  `blocked`, `progress`. It tolerates agent prose: an exact match wins, else the
  last line that is itself a bare token, else a lenient last-word scan.
- `done` and `no-work` run contract checks in order.
- `progress` skips contract checks and returns a typed non-complete result.
- `blocked` returns a typed blocked result and never runs contracts.
- Contract miss after `done`/`no-work` returns a hard non-success result distinct
  from agent-declared `blocked`.
- Runner does not hide retries and does not trigger a second invocation on
  contract miss. One bounded exception: a first response carrying no terminal
  token (including an empty response) triggers exactly one token-only
  re-prompt (`write.token-reprompt`) over the same ordered bindings before
  classification; a second miss — no exact token in the re-prompt reply —
  classifies as `invalid_token` with the *first* response's text. The
  re-prompt reply is accepted only as an exact token, not the lenient scan
  used for the first response. `StepRunResult.invocation` stays the original
  step invocation regardless; when a re-prompt fired, the result also carries
  a `reprompt` field (the first response text plus the re-prompt's own
  `InvocationExecution`) for the caller to log — the runner itself does not
  log it.

Boundary:

- Runner owns token parsing, terminal-result classification, and contract
  dispatch.
- Runner does not own workflow looping, CLI exit mapping/formatting, or
  git/worktree side effects.
- Per-invocation telemetry (`invocation_completed`) emits at the shared
  invocation layer below this runner, with IDs and write-step context passed in
  from the caller. Current live consumer: write-step execution only; callers
  that omit write-step context plus sink stay telemetry no-op. Capture contract:
  [`telemetry-capture.md`](telemetry-capture.md).
- Emission happens after each binding subprocess settles and before this runner
  parses tokens or classifies `contract_miss` / `invalid_token`, so downstream
  non-success classification does not suppress a settled row.

Operator flow for the first `write` consumer is documented in
[`write-behavior.md`](./write-behavior.md).
