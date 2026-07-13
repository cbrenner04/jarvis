# 02 - Operator surface for a rejected blocked token

## Problem

Subspec 01 produces a `missing_blocker` terminal outcome on a `paused` run. `composeRunOperatorError`
(`v2/src/daemon/run-operator-error.ts:159`) special-cases `outcomeKind === "invalid_token"` *before*
consulting `RESUMABLE_TERMINALS`; without an equivalent branch a `missing_blocker` run falls through
the `paused` status mapping and reports as `resumable_pause`. `mapInvocationFromAttempt` (:101)
likewise returns `undefined` for unrecognized outcome kinds. And without a log event the operator
cannot see what the agent actually said.

## Behavior

- `list` and `wait` report the rejected outcome as `reason: "missing_blocker"`, `retryable: true`,
  `nextAction: "resume"` — never `inspect_spec`, since the spec tree has no blocker to inspect, and
  never `resumable_pause`.
- The run log carries a `missing_blocker_detail` event with the agent's response text, truncated at
  `INVALID_TOKEN_LOG_MAX_CHARS` like `invalid_token_detail`.

## Decisions

- `missing_blocker` joins the closed `RUN_OPERATOR_ERROR_REASONS` list, `mapInvocationFromAttempt`'s
  switch, and the outcome-kind precedence path that runs *before* `RESUMABLE_TERMINALS` — rules out
  a type-only addition, which typechecks and still reports `resumable_pause`.
- `retryable: true` / `nextAction: "resume"` — rules out `stop`; the agent's work is on disk and the
  run is `paused`, so resume is the recovery, same as `invalid_token`.
- The detail event is its own kind rather than a reused `invalid_token_detail` — rules out
  conflating an unparseable token with a well-formed token missing its artifact.
- Truncation is one shared helper used by all call sites (`token_reprompt`, `invalid_token_detail`,
  `blocker_reprompt`, `missing_blocker_detail`) — rules out another copy of the inline
  slice-and-ellipsis in `write-loop.ts`.

## Acceptance criteria

- [ ] A run terminated by a rejected `blocked` token reports `reason: "missing_blocker"`,
      `retryable: true`, `nextAction: "resume"` on `list` and on `wait` — not `resumable_pause`.
- [ ] `nextAction` for that run is never `inspect_spec`.
- [ ] An ordinary `blocked` run still reports `agent_blocked` / `retryable: false` / `inspect_spec`
      (`run-operator-error.test.ts` existing blocked cases stay green).
- [ ] The run log contains a `missing_blocker_detail` event carrying the agent's response text,
      truncated to `INVALID_TOKEN_LOG_MAX_CHARS` with the same ellipsis as `invalid_token_detail`.
- [ ] `invalid_token_detail` and `token_reprompt` truncation behavior is unchanged.

## Documentation updates

- `v2/docs/daemon-host.md` — add the `missing_blocker` row to the operator-error reason table.
- `v2/docs/write-behavior.md` — document `missing_blocker_detail` alongside `invalid_token_detail` /
  `token_reprompt`.
