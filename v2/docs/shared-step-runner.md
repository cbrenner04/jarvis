# Shared step-runner contract

`v2/src/step-runner.ts` owns the behavior-agnostic step execution seam above
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
  contract miss.

Boundary:

- Runner owns token parsing, terminal-result classification, and contract
  dispatch.
- Runner does not own workflow looping, CLI exit mapping/formatting, or
  git/worktree side effects.
- Future per-invocation telemetry (`invocation_completed`) emits at the shared
  invocation layer below this runner, with IDs passed in from the caller. Capture
  contract: [`telemetry-capture.md`](telemetry-capture.md).

Operator flow for the first `write` consumer is documented in
[`write-behavior.md`](./write-behavior.md).
