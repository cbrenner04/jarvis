# Shared step-runner contract

`v2/src/execution/step-runner.ts` owns the behavior-agnostic step execution seam above `shared/invocation/execute.ts`.

Contract:

- Input: behavior prompt + ordered invocation bindings + deterministic contracts.
- Invocation is executed exactly once through shared quota fallback.
- Token parsing happens once in runner code and accepts only `done`, `no-work`,
  `blocked`, `progress`. It tolerates agent prose: an exact match wins, else the
  last line that is itself a bare token, else a lenient last-word scan.
- `done` and `no-work` run contract checks in order.
- `progress` skips contract checks and returns a typed non-complete result.
- `blocked` with no `blockerTextContract` returns a typed blocked result and skips
  artifact contracts.
- When `blockerTextContract` is set and the token is `blocked`, the runner checks
  that the spec file gained a new non-empty `## Blocker` section (before/after
  against `specBefore`, same shape as `hasGenuineBlocker` in
  `shared/spec-parser.ts`). Pass → ordinary `blocked`. Miss → exactly one
  blocker-text re-prompt (`write.blocker-reprompt`) over the same bindings, then
  re-check. Second miss → `missing_blocker` with the re-prompt response text
  (not `blocked`, not `contract_miss`). The re-prompt carries
  `StepRunResult.blockerReprompt`, not `reprompt`, so callers can log it without
  emitting `token_reprompt`.
- Contract miss after `done`/`no-work` returns a hard non-success result distinct
  from agent-declared `blocked`.
- After the token-only re-prompt, a still-missing token runs the same contract
  checks as `done`/`no-work`: all pass → `complete` (token `done`); any fail →
  `invalid_token` with the first response's text (not `contract_miss` — the
  agent made no terminal claim to contradict).
- Runner does not hide retries and does not trigger a second invocation on
  contract miss. One bounded exception: a first response carrying no terminal
  token (including an empty response) triggers exactly one token-only
  re-prompt (`write.token-reprompt`) over the same ordered bindings before
  classification; a second miss — no exact token in the re-prompt reply —
  runs contract checks: all pass → `complete` (token `done`); any fail →
  `invalid_token` with the *first* response's text. The re-prompt reply is
  accepted only as an exact token, not the lenient scan used for the first
  response. `StepRunResult.invocation` stays the original
  step invocation regardless; when a re-prompt fired, the result also carries
  a `reprompt` field (the first response text plus the re-prompt's own
  `InvocationExecution`) for the caller to log — the runner itself does not
  log it.
- `runStep`'s input takes an optional `sessionLog` (see
  [`shared-invocation.md`](./shared-invocation.md#session-log-writer)), passed
  straight through to both the initial `executeWithQuotaFallback` call and the
  token-only re-prompt's `executeWithQuotaFallback` call, so both invocations'
  binding attempts land in the same log. Omitting it is a no-op, matching
  callers that predate this field.

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

Operator flow for the first `write` consumer is documented in [`write-behavior.md`](./write-behavior.md).
