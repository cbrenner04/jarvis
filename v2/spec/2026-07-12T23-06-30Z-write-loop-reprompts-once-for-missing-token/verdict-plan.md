## Verdict — refinements required

The subspec is correctly scoped (one code path in `runStep` plus its `write.ts` caller); no split needed. But it asserts several either/or design forks without choosing, and its layering claims contradict the code. Refine as follows.

### 1. Decide how the re-prompt fact reaches the run log
`runStep` has no `LogSink` — its input is `{prompt, cwd, bindings, contracts, signal, telemetry}` — and the `invalid_token_detail` event is emitted by the write loop, which owns the sink and the attempt id. The spec asserts both "at most one re-prompt per step, in the runner" and a run-log event, without saying how the fact crosses that boundary. Pin it: either the classification result carries the re-prompt fact (first response text, whether a re-prompt happened) and the loop logs it, or the runner grows a sink. State which, and why. Keeping the shared runner sink-free is the property currently worth defending; if the spec chooses that, say so in the ledger.

### 2. Decide where the re-prompt prompt text comes from
The runner is prompt-agnostic today: `write.ts` renders the prompt and hands `runStep` a finished string. A `prompts/write/…` artifact *read by the runner* inverts that layering; threading a template through `StepRunInput` obligates every future caller. The spec picks neither. Choose one and record the rejected alternative. If a new registry entry lands, add `v2/docs/prompts.md` to the documentation-updates list.

### 3. Pin `invocationIds` cardinality and origin
`invocationIds` is caller-supplied and indexed by binding; every existing caller mints one id per binding. "Fresh `invocationIds`" as written is under-specified and invites a duplicate-key bug. Say one per binding, and say who mints them.

### 4. Say what happens to re-prompt cost
The boundary commit derives `bindingAttempts` from `result.invocation.attempts`. Freezing `invocation` to the original step invocation — which the spec is right to do, so a fallback binding never becomes `completionAgent` — silently drops the re-prompt's attempts, cost, and usage from the attempt record. Decide explicitly: the loss is accepted (and stated), or the re-prompt's attempts get their own carrier. Do not leave it invisible.

### 5. Tighten parsing of the re-prompt reply
The step-outcome parser falls back to a last-token-anywhere scan, so a hedging reply ("I can't tell if this is done, no-work, blocked, or progress") parses as `progress` and the loop keeps iterating on a possibly-finished step. This is a *tightening* applied only to the re-prompt reply, so it does not violate the intent's "don't loosen the parser" boundary. Add a decision (the re-prompt reply is accepted only as an exact token) and an acceptance criterion.

### 6. Handle empty first-response output
A decision states the re-prompt body "carries the first response text." When the agent's stdout is empty that body degenerates. Do not gate the feature on non-empty output — empty output is exactly the case where the work may be done and only the report is missing. Pin how the re-prompt behaves with an empty first response.

### 7. Record two accepted risks in the ledger
- The re-prompt runs a real binding against the worktree; prompt hygiene is the only thing keeping the classifier from doing work. Record as accepted risk (a classifier prompt with no write instructions and no spec context has nothing to do), not as new machinery.
- The re-prompt runs inside the same iteration timeout budget and roughly doubles worst-case step wall-clock; a timeout firing mid-re-prompt aborts it like any other in-iteration invocation. State this so nobody later "fixes" it by widening the budget.
- Also state plainly that this changes `runStep`'s contract for *every* caller, not just the write loop.

### 8. Missing acceptance criteria
- A step whose **first** invocation fails classifies as `invocation_failure` and triggers **no** re-prompt (the current AC covers only the mirror case).
- The run-log AC names the event kind and says what the operator sees on a second miss (re-prompt event plus `invalid_token_detail`, or one merged event). This is a harness subspec, so naming the event kind is in-bounds.
- A re-prompt reply of `done` whose expected artifact is absent still fails to `contract_miss`. A hallucinating classifier is this feature's most likely failure mode and the current criteria only gesture at it parenthetically.

### Not upheld
`v2/docs/v1-behaviors.md` needs no update — this is net-new v2 behavior, not a change to existing v1 functionality.