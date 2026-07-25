---
name: review-role-bound-is-operator-settable
---

# Review-role wall clock is a configured value, not the write-loop constant

`review-role-invocation.ts` falls back to `write-loop.ts`'s `DEFAULT_ITERATION_TIMEOUT_MS`
(600_000) because `roleTimeoutMs` is declared on three types and forwarded once but never set
anywhere. Make it a real machine-config key with its own default.

## Decisions

- Add a machine-config key for the review-role bound and resolve it where the other write-path bounds are resolved; rules out a CLI-flag-only or hardcoded raise that leaves the value unversioned.
- Thread the resolved value into the already-declared `roleTimeoutMs` on the review-cycle, review-debate, and review-role-invocation types; rules out introducing a parallel bound parameter beside the plumbed one.
- Default the bound to `1_800_000` ms, matching `DEFAULT_ITERATION_CEILING_MS`; rules out keeping 600_000, whose p90 (548s) is already at the wall.
- No production path may resolve a review-role bound from `DEFAULT_ITERATION_TIMEOUT_MS`; rules out leaving the write-loop import as a silent fallback.
- Out of scope: escalation on overrun, and the size of the diff the actuator receives.

## Acceptance criteria

- [ ] A configured review-role bound reaches `invokeReviewRole`; a test asserts the configured value is honored.
- [ ] With no key configured the bound is 1_800_000 ms, not `DEFAULT_ITERATION_TIMEOUT_MS`; reverting the wiring so the parameter goes unset fails the test.

## Documentation updates

- `v2/docs/install-and-config.md` — the new machine-config key, its default, and what it bounds.
- `v2/docs/v1-behaviors.md` — review roles no longer inherit the write-loop iteration default.

## Prerequisites
