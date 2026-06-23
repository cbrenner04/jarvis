---
name: verify-session-prs-merged
---

# Silent merge failures need a harness-side merge/PR-state sweep

## Problem

When a `gh pr merge` is bundled with a long background run in one command, a failed merge is
**silent**: the merge errored (PR still draft at that instant), the no-`&&` chain continued, and the
next run launched anyway. Observed in the overlord session (`reports/2026-06-23T09-10-00Z-overlord.md`):
backfill PR #461's merge failed silently and was caught **only** by a manual end-of-session open-PR
sweep. The current mitigation is pure operator discipline ("never bundle a merge with a launch;
merge foreground, observe, then sweep") — i.e. a manual step the north star wants the harness to own.

## Direction

Give the harness a way to confirm a session's work actually merged, instead of relying on the
operator to remember a final sweep. Options for plan to weigh:

- A `jarvis` affordance that lists this session's draft/open/unmerged PRs (and their gate state) so
  "did everything land?" is one command, not eyeballing GitHub.
- Make merge-after-completion verify the result (poll merged-state) and surface a clear failure
  rather than returning success on a fire-and-forget `gh pr merge`.

## Out of scope

- Auto-merging without operator sign-off (operator-merges-only stays the model).
- The post-completion *review* failure case — already seeded
  ([[review-phase-failure-distinct-from-impl-incomplete]]).

## References

- `reports/2026-06-23T09-10-00Z-overlord.md` — "Bundling `gh pr merge` + a long run hid a failed merge."
- `v1/docs/operator-runbook.md` — session-end sweep currently lives here as a manual rule.
