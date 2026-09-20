---
name: wal-lock-holder-child-survives-to-marker
---

# The WAL concurrency lock holder reaches its marker under concurrent load

## Problem

`v2/src/persistence/state-store-wal-concurrency.test.ts` ("second writer on separate connection commits without database is locked") spawns `bun --eval` as a lock holder and awaits `jarvis-lock-held`. The child intermittently exits before the marker under concurrent load (CI run 35172007671 on PR #3954; a local `test:v2` gate on 2026-09-17, passing 4/4 in isolation).

## Behavior

The captured child stderr and exit code from the improved rejection are recorded in the spec, and the lock-holder script or its spawn setup is changed to remove the recorded cause (e.g. database-path contention, cwd or module resolution under load). The WAL/busy-timeout assertions are unchanged; the test passes repeated consecutive runs at the CI pool width with other `test:v2` files co-running.

## Prerequisites

- `waitForStdoutMarker` rejections include the child's exit code, signal, and stderr tail.
