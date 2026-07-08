## Verdict

**Required refinement 1 — Correct the test-deletion premise.**
`tui-log-tail-client.test.ts` does not currently contain tests that construct a well-enveloped payload with a fabricated bad `seq`/`ts`/`event.kind`. The only shape-related test exercises a JSON-parse failure, which the spec already says to keep. The spec's Decisions, Task checklist, and Acceptance criteria must not describe deleting test sections that don't exist. Replace this with an accurate statement of what the test file actually needs.

**Required refinement 2 — Require new test coverage for the narrowed envelope check.**
Since no existing test asserts rejection of a malformed-but-JSON-valid payload, the spec must add a task/AC requiring new tests that verify the envelope check itself: rejection when `runId` is missing/non-string, and when `event` is missing/not an object. Without this, AC 1 (throwing `TuiDaemonConnectionError` on missing `runId`/`event`) is unverified by any actual test, and a broken narrowing could ship undetected.

**Rationale:** The spec's job is to describe an accurate, verifiable change. An AC or task that references non-existent test sections is a no-op that can't be satisfied truthfully, and an AC with no test enforcing it fails the spec's own acceptance-criteria contract. Both corrections are needed for the spec to be implementable and independently verifiable per spec guidance.

**Not required:** Corruption-of-persisted-log defense-in-depth and error-message-granularity wording are minor/optional — no refinement needed; leave as-is or address with at most a one-line note if convenient, but do not block on them.