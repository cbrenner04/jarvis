Confirmed — this is a real regression, not an over-reach.

## Verdict

**Upheld issue: the fix drops per-status coverage for the 5 shouldWait cases.**

`getChecks()` now hardcodes `"in_progress"` for every shouldWait case instead of returning `testCase.status`. Previously each shouldWait case (`pending`, `queued`, `in_progress`, `action_required`, `stale`) had its actual status classified on the first poll before falling back to `"in_progress"` on a would-be second poll. The new single-poll version discards the original per-case status entirely, so the test now only exercises `classifyCiChecks`/`waitForCiGreen` classifying `"in_progress"` as "wait" — five times — instead of proving each of the five distinct statuses classifies as "wait."

**Required outcome:** Each shouldWait case's single poll must still return that case's actual `testCase.status` (e.g. `getChecks: () => { pollCount++; return [{ name: "test", status: testCase.status }]; }`), not a hardcoded `"in_progress"`. This preserves per-status classification coverage while still reducing to exactly one poll per case (consistent with `pollTimeoutMs: 0`).

**Rationale:** The subspec's own acceptance criteria require the fix to leave classification behavior and its test coverage unchanged ("classification assertions for all 12 statuses still pass," "behavior unchanged"), and the Decisions section's justification for moving to a single poll explicitly relies on the premise that one poll is sufficient to exercise each status's classification — that premise only holds if the one poll still passes through the real status. Hardcoding `"in_progress"` silently narrows test coverage in a way the spec forbids.