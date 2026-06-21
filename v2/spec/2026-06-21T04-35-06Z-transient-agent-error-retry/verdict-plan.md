# Verdict — Refinements Required

The spec's core design (single `runAgent` chokepoint, sibling classifier on the residual `error`, no union changes) is sound and should be preserved. But its central architectural claim — "every caller's control flow is byte-for-byte unchanged" — is false as written, because re-spawning re-fires per-spawn callbacks that carry side effects in the first consumer. The following must be addressed before this spec is implementable.

## Blocking

1. **Resolve the per-spawn callback side-effect leak.** `runAgent` fires `onSpawned({ pid })` once per spawn, so retrying re-fires it. Patch's `onSpawned` is not pure observability — it sets watchdog pid state and assigns a `setInterval` poll handle whose cleanup runs once per *iteration*, outside `runAgent`. A second attempt therefore overwrites the poll handle (leaking the prior interval on a dead pid) and repoints the watchdog at only the latest child. The spec must make an explicit decision: either `runAgent` resets/cleans per-attempt resources across the retry boundary, or `onSpawned` is contractually defined as fire-per-attempt *and* patch is made re-entry-safe. The "byte-for-byte unchanged" framing must be corrected to scope it to side-effect-free callbacks. This is the load-bearing correctness gap.

2. **Pin the retry cap value.** The spec says "a few re-attempts," the trace assumes 2, and an AC says the test pins the cap — but the number is never stated. A fixed internal constant has no "first consumer" to defer to; the value is load-bearing now (it is the runtime bound and the test expectation). State the concrete cap in the Decisions block.

3. **Pin the notice-callback contract and the harness string.** The first consumer (patch) exists now, so this is not a valid first-consumer deferral. Specify the callback payload (e.g. attempt index, cap, agent identity) and the exact patch harness line. The current AC only asserts the string *differs* from the quota strings, which under-constrains it.

## Should-fix

4. **Specify the watchdog/idle interaction across the re-spawn gap.** Idle age and the iteration timeout span the whole iteration, not per-attempt, so they accrue across the dead gap between attempts and during the sum of attempts — an idle or iteration abort may land mid-retry. State the intended interaction and that such an abort is acceptable (it terminates correctly via the existing abort path). The abort decision currently reasons only about the *result* of an abort, never about time accruing across the gap.

5. **Use a single abort predicate.** Two decisions key off different things (`opts.signal.aborted` vs. an `aborted:` stderr prefix). The stderr prefix is derived from abort handling and is the wrong key. Choose `opts.signal?.aborted` and cover both "don't start a retry once aborted" and "the in-flight result was an abort."

## Clarify

6. **Justify or narrow no-backoff for overload statuses.** Immediate zero-backoff retry of `502/503/504/529`/"overloaded" can re-hit the throttle and burn the cap. Either justify in one line that capped immediate retry still strictly beats today's terminal-error behavior (the cap guarantees termination), or narrow the seed patterns to genuine transport drops and defer gateway/overload statuses.

7. **Anchor the numeric status patterns.** `checkSettlement` scans the agent's own stdout/stderr, so a bare `503`/`429`-style match risks re-running a genuinely failed attempt when the agent merely prints a number in its work output. Mirror the existing anchored quota patterns (status codes co-occurring with error/http/status context) rather than matching bare numbers.

8. **Note unrecorded failed-attempt spend.** A discarded intermediate attempt's tokens go unrecorded, so "telemetry unchanged" is literally true but misleading — retries are not free. State this.

9. **Confirm transport drops arrive as non-zero exits.** The exit-0 deferral is sound only if Claude surfaces transport drops as non-zero exits (where the classifier engages) rather than exit-0 JSON error envelopes. Add one sentence confirming this, since the exit-0 guard otherwise risks missing the primary case for the default agent.

## Conventions

No violations. This is a harness subspec, so naming symbols/files/strings as contract is legitimate; the preservation AC correctly cites tests; the docs targets exist and the `v1-behaviors.md` update is correctly required (this spec does change existing behavior — `error` is no longer unconditionally terminal).