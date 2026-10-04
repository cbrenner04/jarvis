## Verdict: Required Refinements

**1. Subspec 03 must exclude 00–02's files by explicit scope, not sequencing prose.**
"Run this subspec after 00-02 land" is an ordering note, not an enforced boundary — the harness can select/resume subspecs out of numeric order. Subspec 03's Decisions or Task checklist must explicitly list `tui-monitor-types.ts`, `tui-daemon-client.ts`, `daemon.ts`, and `log-stream.ts` as excluded from its sweep, independent of whether 00–02 have landed yet.

**2. Every subspec needs an acceptance criterion that guards "comments-only."**
Typecheck and test-suite ACs verify behavior is unchanged, but nothing in the current draft verifies the *mechanism* of the change — that only comment/whitespace lines were touched. Since "zero behavior change, comments only" is the central promise of every subspec in this intent, each subspec (00, 01, 02, 03) needs an AC that the diff for its touched file(s) shows only comment/whitespace-line changes (e.g., verifiable via a scoped `git diff`).

**3. Subspec 00 must assert its keep-list item as an AC, matching 01 and 03.**
Subspecs 01 and 03 both include an AC confirming their keep-list comment (revision-inactive-statuses; snapshot-grafting guard, telemetry-presence rule, review-debate convention) is present and unmodified. Subspec 00 names `connectTuiDaemon`'s contract block as a keep item in its Decisions but has no corresponding AC. Add one for consistency and to actually gate the load-bearing comment against accidental removal.

**4. Note confirmation of the seed-01 prerequisite (amended documentation standard is committed and in effect).**
Spec guidance requires the drafting agent to confirm intent prerequisites before drafting. The intent's prerequisite that "seed 01's amended comment/documentation standard is committed and in effect" isn't shown as checked anywhere in the draft (subspec 02 does this for its own watcher-removal prerequisite). Add a one-line confirmation — either in the index or in a subspec — that this prerequisite was verified against `v2/docs/documentation-standard.md`.

**5. Subspec 02's claim that no watcher-related comment exists in `log-stream.ts` should be a checked task, not an assumed fact.**
The Decisions section asserts this as settled, but the intent's second prerequisite exists specifically because this needed verification. Add a Task checklist item to confirm this before trimming, so the implementer has an explicit checkpoint if the assumption is wrong.

No other changes required — subspec 03's sweep scope, the test-file/doc-file boundary, and the per-subspec test-scope granularity are already adequately bounded by the intent's "when in doubt, keep" bias and the standing project-wide test-gate rule, and don't need spec edits.