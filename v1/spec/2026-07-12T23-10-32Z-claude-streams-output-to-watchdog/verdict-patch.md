**Required outcome:**

Add an end-to-end test proving AC01's primary success-path claim: a `ClaudeAgent` iteration that streams events and completes normally (no timeout, no escalation) results in a `runs.jsonl` row with a non-null `last_output_age_ms`.

**Rationale:** AC01 states "A claude patch iteration populates `last_output_age_ms` in `~/.jarvis/runs.jsonl` the way codex and opencode do." Current coverage proves the underlying mechanism (`lastOutputAtMs` advances across stream chunks in `claude-agent.test.ts`) and proves the *timeout/escalation* path writes a non-null value in `run.test.ts`. Neither directly exercises the literal scenario the AC describes — a normally-completed claude iteration. Without this test, the AC's primary success case rests on inference from adjacent tests rather than direct verification.

No other findings require action: the non-`result`-typed-line handling is an intentional, spec-mandated narrowing (00's decision explicitly states non-result events contribute nothing), and fixture-based NDJSON coverage is consistent with existing conventions for the batch-envelope tests in this suite.