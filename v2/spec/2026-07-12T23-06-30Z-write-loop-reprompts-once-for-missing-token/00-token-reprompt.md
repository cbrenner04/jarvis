# 00 - Re-prompt once for a missing terminal token

`runStep` (`v2/src/execution/step-runner.ts`) classifies a token-less agent response
as `invalid_token`, and the write loop commits that as a failed terminal boundary.
The step's work is already on disk; only the token is missing. Give the agent one
cheap chance to name the token before classifying.

## Decisions

- The re-prompt is a token-classification prompt, not a re-run: its body carries the
  first response text and asks for exactly one of `done`/`no-work`/`blocked`/`progress`, nothing else. Rules out re-sending the write instructions, which would risk duplicate work.
- The re-prompt is a new registered prompt artifact (`prompts/write/…`, listed in `prompts/registry.txt`) rather than a string literal in the runner — prompt text is registry-owned in this repo.
- The re-prompt runs through `executeWithQuotaFallback` over the same ordered bindings; the classifier does not need the worker's session, so quota fallback to a later binding is acceptable.
- The returned `StepRunResult.invocation` stays the *original* step invocation. Rules out merging the re-prompt attempts in, which would let a fallback binding become the run's `completionAgent` for work it did not do.
- When telemetry is attached, the re-prompt invocation gets fresh `invocationIds`; reusing the step's ids would emit duplicate-keyed `invocation_completed` rows.
- A re-prompt whose invocation fails (quota, error, no binding) is treated as a second miss → `invalid_token`. Rules out reclassifying the step as `invocation_failure`, which would mis-attribute the failure to the step whose invocation succeeded.
- `invalid_token.tokenText` keeps the *first* response text. Rules out overwriting it with the re-prompt reply, which is the less informative of the two.
- At most one re-prompt per step, in the runner. Rules out a write-loop-level retry, which would re-run the whole write step.

## Acceptance criteria

- [ ] A step whose agent output carries no terminal token triggers exactly one additional invocation that asks only for the token; the token it returns classifies the step normally (`complete` runs contracts, `progress`/`blocked` classify as such).
- [ ] A second miss — the re-prompt reply also carries no token — classifies as `invalid_token`, with the first response's text reported as `tokenText`.
- [ ] A step whose first response carries a token triggers no re-prompt (one invocation total).
- [ ] The re-prompt fires at most once per step: a token-less re-prompt reply does not trigger a third invocation.
- [ ] A failed re-prompt invocation (quota exhausted / error / no binding) classifies the step as `invalid_token`, not `invocation_failure`.
- [ ] When a re-prompt happens, the run log records it — an event naming the attempt and the first (token-less) response text, truncated to `INVALID_TOKEN_LOG_MAX_CHARS` — and `jarvis2 tui` log-follow renders it.
- [ ] Completion attribution (`completionAgent`) and per-invocation telemetry rows for the step reflect the step's own invocation; the re-prompt emits its own row with distinct invocation ids and never becomes the completion binding.

## Documentation updates

- `v2/docs/shared-step-runner.md` — token parsing finding nothing now triggers one token-only re-prompt before classification; second miss is `invalid_token`. Amend the "no hidden retries" line to name this bounded exception.
- `v2/docs/write-behavior.md` — the missing-token re-prompt path and the run-log event operators see.
- `v2/docs/telemetry-capture.md` — a re-prompted step emits a second `invocation_completed` row.
