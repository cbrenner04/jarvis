# 00 - Re-prompt once for a missing terminal token

`runStep` (`v2/src/execution/step-runner.ts`) classifies a token-less agent response
as `invalid_token`, and the write loop commits that as a failed terminal boundary.
The step's work is already on disk; only the token is missing. Give the agent one
cheap chance to name the token before classifying.

## Decisions

- The re-prompt is a token-classification prompt, not a re-run: its body carries the first response text and asks for exactly one of `done`/`no-work`/`blocked`/`progress`, nothing else. Rules out re-sending the write instructions, which would risk duplicate work.
- The re-prompt lives in the runner and fires for every `runStep` caller, not just the write loop — this changes `runStep`'s contract repo-wide.
- The re-prompt text is a registry artifact (`prompts/write/token-reprompt.md`, id `write.token-reprompt`, listed in `prompts/registry.txt`) loaded by the runner. The runner owns the token vocabulary, so it owns the prompt asking for a token. Rules out threading a template through `StepRunInput`, which would obligate every caller to supply one and let callers diverge from the token contract the runner alone enforces.
- The runner stays sink-free. `StepRunResult` grows an optional `reprompt` field — present only when a re-prompt fired — carrying the first (token-less) response text and the re-prompt's `InvocationExecution`; the write loop, which owns the sink and the attempt id, logs it. Rules out passing a `LogSink` into the shared runner; sink-freedom is the layering property worth defending.
- The re-prompt runs through `executeWithQuotaFallback` over the same ordered bindings; the classifier does not need the worker's session, so quota fallback to a later binding is acceptable.
- The re-prompt reply is accepted only as an exact token (trimmed stdout equals one of the four). Rules out reusing the lenient last-token-anywhere scan, under which a hedging reply ("I can't tell if this is done, no-work, blocked, or progress") parses as `progress` and the loop iterates a possibly-finished step. Scoped to the re-prompt reply; the step-response parser is unchanged.
- An empty first response still triggers the re-prompt — empty output is exactly the case where the work may be done and only the report is missing. The prompt body says the previous response was empty in place of the response text.
- The returned `StepRunResult.invocation` stays the *original* step invocation. Rules out merging the re-prompt attempts in, which would let a fallback binding become the run's `completionAgent` for work it did not do.
- Consequence, accepted: the re-prompt's attempts, cost, and usage never reach the attempt record's binding attempts (derived from `result.invocation.attempts`). They stay visible in telemetry (its own `invocation_completed` row) and in the run log. Rules out a second cost carrier in the state store.
- The re-prompt's telemetry context reuses the step's, except `invocationIds`: the runner mints one fresh id per binding, same length and order as `bindings`. Rules out reusing the step's ids, which would emit duplicate-keyed `invocation_completed` rows.
- A re-prompt whose invocation fails (quota, error, no binding) is treated as a second miss → `invalid_token`. Rules out reclassifying the step as `invocation_failure`, which would mis-attribute the failure to the step whose invocation succeeded.
- `invalid_token.tokenText` keeps the *first* response text. Rules out overwriting it with the re-prompt reply, which is the less informative of the two.
- At most one re-prompt per step, in the runner. Rules out a write-loop-level retry, which would re-run the whole write step.

### Accepted risks

- The re-prompt runs a real binding against the worktree; prompt hygiene is the only thing keeping the classifier from doing work. A classifier prompt with no write instructions and no spec context has nothing to do. No sandboxing machinery.
- The re-prompt runs inside the same iteration timeout budget and roughly doubles worst-case step wall-clock; a timeout firing mid-re-prompt aborts it like any other in-iteration invocation. The budget is not widened.

## Acceptance criteria

- [ ] A step whose agent output carries no terminal token triggers exactly one additional invocation that asks only for the token; the token it returns classifies the step normally (`complete` runs contracts, `progress`/`blocked` classify as such).
- [ ] An empty first response triggers the re-prompt like any other token-less response.
- [ ] A second miss — the re-prompt reply carries no exact token — classifies as `invalid_token`, with the first response's text reported as `tokenText`.
- [ ] A hedging re-prompt reply that names tokens in prose ("done, no-work, blocked, or progress?") is a second miss, not `progress`; the step-response parser's lenient scan is unchanged.
- [ ] A step whose first response carries a token triggers no re-prompt (one invocation total).
- [ ] A step whose *first* invocation fails (quota / error / no binding) classifies as `invocation_failure` and triggers no re-prompt.
- [ ] The re-prompt fires at most once per step: a token-less re-prompt reply does not trigger a third invocation.
- [ ] A failed re-prompt invocation (quota exhausted / error / no binding) classifies the step as `invalid_token`, not `invocation_failure`.
- [ ] A re-prompt reply of `done` whose expected artifact is absent classifies as `contract_miss` — contracts run against a re-prompted token exactly as against a first-response token.
- [ ] When a re-prompt happens, the write loop appends a `token_reprompt` run-log event naming the attempt and the first (token-less) response text, truncated to `INVALID_TOKEN_LOG_MAX_CHARS`, and `jarvis2 tui` log-follow renders it. On a second miss the operator sees that event followed by the existing `invalid_token_detail` event.
- [ ] Completion attribution (`completionAgent`) and the attempt record's binding attempts reflect the step's own invocation; the re-prompt emits its own `invocation_completed` row with one distinct invocation id per binding and never becomes the completion binding.

## Documentation updates

- `v2/docs/shared-step-runner.md` — token parsing finding nothing now triggers one token-only re-prompt before classification; second miss is `invalid_token`. Amend the "no hidden retries" line to name this bounded exception, and note the result carries the re-prompt fact rather than the runner logging it.
- `v2/docs/write-behavior.md` — the missing-token re-prompt path and the `token_reprompt` run-log event operators see.
- `v2/docs/prompts.md` — the new `write.token-reprompt` registry entry.
- `v2/docs/telemetry-capture.md` — a re-prompted step emits a second `invocation_completed` row; its cost is not in the attempt record's binding attempts.
