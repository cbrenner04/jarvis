---
name: wal-lock-holder-child-survives-to-marker
---

# The WAL concurrency lock holder reaches its marker under concurrent load

## Problem

`v2/src/persistence/state-store-wal-concurrency.test.ts` ("second writer on separate connection commits without database is locked") spawns `bun --eval` as a lock holder and awaits `jarvis-lock-held`. The child intermittently exits before the marker under concurrent load (CI run 35172007671 on PR #3954; a local `test:v2` gate on 2026-09-17, passing 4/4 in isolation).

## Behavior

Reproduce by running `bun run test:v2` repeatedly (up to 20 runs) until the improved rejection captures the child's stderr and exit code. Record the cause in a comment above the lock-holder spawn, and change the lock-holder script or its spawn setup to remove it. The WAL/busy-timeout assertions are unchanged.

If 20 full `test:v2` runs never reproduce the failure, close the intent as unreproducible: make no speculative change.

The regression test is deterministic: it forces the identified cause (e.g. via the spawn setup) and fails against the pre-fix lock-holder. If the cause cannot be forced deterministically, the fix is exempt from a failing-test criterion and the comment records why.

Done when the file passes 20 consecutive `bun run test:v2` runs.

## Prerequisites

- Hard dependency: intent `subprocess-marker-rejection-carries-cause` lands first. `waitForStdoutMarker` rejections then include the child's exit code, signal, and stderr tail.
