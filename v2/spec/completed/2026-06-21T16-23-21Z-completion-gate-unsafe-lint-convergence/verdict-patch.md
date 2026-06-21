## Verdict

The core mechanism is correct and complete: the full-tier auto-fix step is swapped to the unsafe superset, the trailing `check` is preserved, the fast tier is untouched, all four `v1-behaviors.md` entries (including the `Sources` attribution fix) are updated, and the prior refinement requirements are satisfied. No correctness issues.

One required outcome:

**1. Remove dead speculative flexibility in the new test helper (required, low).**
The test file was refactored to collapse the three fast-tier signal/timeout cases into a shared helper. That helper carries a `tier` parameter (defaulting to `"fast"`) that no call site ever exercises with any value other than the default. This is unused speculative flexibility — it must be dropped so the helper takes only what its callers actually use. Rationale: the repo's "keep changes minimal, no speculative" standard applies to test code as well; a parameter with a single never-overridden value is dead surface.

Not required:
- The DRY refactor of the three fast-tier tests itself exceeds the subspec's stated test scope ("order assertions plus the source-string guard"), but it is a net line reduction, changes no asserted behavior, and all acceptance criteria remain green. Reverting it is optional polish, not a fix — leave it to actuator discretion once the dead parameter is removed.
- No additional acceptance criterion pinning the convergence outcome is needed; the commit-and-recheck path that produces convergence is already tested and untouched by this change.