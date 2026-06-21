---
name: snapshot-update-pass-before-preexisting-blocker
---
# Snapshot update + re-test before a "pre-existing failures" blocker stands

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

- Base-ref reproduction of the cited failures (separate intent).
- Auto-ticking ACs.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the snapshot-update + re-test gate and how the
  update command is resolved.

## Prerequisites

- The harness intercepts a pre-existing-failures blocker claim before it halts the run.
- The harness can run the target repo's test command.
