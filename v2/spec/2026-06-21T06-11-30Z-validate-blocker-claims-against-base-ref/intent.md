---
name: validate-blocker-claims-against-base-ref
---
# Validate "pre-existing failure" blocker claims against the base ref

## Problem

On snapshot-heavy target repos the patch agent runs tests mid-edit, sees transient
mismatches, and raises a `## Blocker` (exit 7) or red verdict citing "N pre-existing
failures unrelated to my change." Every observed case was false: the base ref was green
and a fresh re-run after the agent finished passed. The harness halts the run on the
agent's own churn.

## Direction

When a patch-mode blocker or red completion verdict cites pre-existing / unrelated /
baseline failures, reproduce the cited failures on the base ref before letting the
blocker stand. The harness already knows the base ref and the target test command.

- Detect blocker/verdict text that claims failures are pre-existing/unrelated/baseline.
- Re-run the cited failures (or the suite) against the base ref.
- If they do not reproduce on the base ref, reject the blocker: the run continues
  instead of exiting 7.
- If they do reproduce, the blocker stands (real pre-existing breakage).

## Out of scope

- Auto-ticking or auto-passing ACs — a real regression still blocks.
- Snapshot update/re-test handling (separate intent).
- Flaky-test serial re-run.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record base-ref blocker-claim validation and its exit-code
  effect.

## Prerequisites

- Patch-mode blocker detection halts the run with exit 7.
- The harness resolves the base ref and can run the target repo's test command.
