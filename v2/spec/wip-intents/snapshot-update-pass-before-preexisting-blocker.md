# Snapshot update + re-test before a "pre-existing failures" blocker stands

## Deferred (2026-06-21)

Deferred during the overlord batch. Reason: **overindexing on a specific project type.**
Detecting and running a snapshot-update command (bun/vitest/jest) bakes JS-snapshot-runner
specifics into a general harness, for a case [[validate-blocker-claims-against-base-ref]]
(merged) already covers in the common form — agent churns mid-edit, base ref is green →
blocker rejected. This gate would only add coverage for "base ref is red but updating
snapshots makes the tree green," a narrow case, via a gate that auto-runs `--update-snapshots`
to dismiss a blocker.

The regression-masking risk (an update-pass blesses agent-broken output the same as a stale
snapshot) was judged acceptable on its own — snapshot updates are reviewable PR artifacts.
The deciding factor was generality, not risk. Revisit only if a snapshot-heavy target repo
makes the marginal coverage worth the project-specific machinery.

A full plan was drafted and reviewed (adversary-validated) before deferral; see git history
for closed PR #341 if resurrected.

## Problem

The false "pre-existing failures" blockers were outdated snapshots, not real breakage —
the agent ran tests before finishing its snapshot updates. Treating outdated snapshots
the same as real failures lets snapshot churn halt the run.

## Direction

Before a "pre-existing failures" blocker claim is allowed to stand, run an
update-snapshots pass and re-test; if the suite then passes, the blocker was snapshot
churn and is rejected.

- Distinguish outdated snapshots from real failures.
- Run a project-detected/configured update-snapshots command, then re-test.
- The update command is target-repo-agnostic — detected or configured, never hardcoded.
- If re-test passes, reject the blocker; if it still fails, the blocker proceeds.

## Out of scope

- Base-ref reproduction of the cited failures — shipped in [[validate-blocker-claims-against-base-ref]].
- Auto-ticking ACs.
