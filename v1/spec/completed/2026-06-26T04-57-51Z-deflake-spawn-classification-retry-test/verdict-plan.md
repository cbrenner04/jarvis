## Verdict

### Required refinements

**1. Correct the root-cause diagnosis (upheld, blocking).**
The spec's stated mechanism is internally inconsistent with the actual test config and must be fixed before merge. The effective per-test timeout is **30000ms** (set in `bunfig.toml`), not the 5000ms the intent and subspec `00` cite. The transient-retry backoff is ~7000ms nominal (`[1000, 2000, 4000]` across three attempts), which cannot intermittently trip a 5000ms bound (it would fail every run) and sits well under a 30000ms bound. The literal "real sleep burns the schedule → tips the timeout" arithmetic is therefore false as written.

The spec must:
- Pin the real effective timeout (30000ms from `bunfig.toml`).
- Reframe the failure mechanism as **event-loop starvation amplification under `bun test --parallel`** — under a saturated loop the `setTimeout` backoff callbacks fire far later than their nominal delays, ballooning the ~7000ms nominal past the 30000ms bound — rather than "7000ms > timeout."
- Drop or correct the inherited "5000ms (~5001ms)" figure instead of restating it.

This is a narrative/diagnosis correction, **not** a change of fix direction. The no-op `sleepMs` fix is correct and robust precisely because it removes the loop's entire wall-time dependency regardless of which mechanism amplifies it. Rationale: spec guidance requires decisions and claims a reviewer can verify; an unverified, self-contradictory diagnosis presented as settled fact prevents a reviewer from confirming the fix targets the real cause.

**2. Scope AC #2's wall-time claim to the transient test (upheld, minor).**
Only the transient test (the `"connection reset: refresh token revoked"` case) ever enters the backoff path; the other five classify on the first spawn and never sleep, so "no longer depends on the real backoff wall-time" is vacuously true for them. Tighten AC #2 to attribute the wall-time dependency to the transient test specifically, while keeping the "all six stay green with current expected results" regression guarantee.

### Not required

- **No regression guard** for a future edit dropping `sleepMs` is reasonably out of scope — the intent scopes this to deflaking one test, and an enforced invariant is additive. An optional one-line inline comment at the call site explaining why `sleepMs` is injected is acceptable but not required.

### Confirmed sound (no action)

Drop-real-sleep over raise-the-bound is the correct, robust choice; the Decisions correctly rule out the wrong alternatives via the existing `opts.sleepMs` hook with no production change; the no-op `sleepMs` is type-valid; classification is genuinely sleep-independent, so the six expected results hold; and skipping `v2/docs/v1-behaviors.md` is correct (test-only, no runtime behavior change).