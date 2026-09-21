---
name: wal-lock-holder-child-survives-to-marker
---

# The WAL concurrency lock holder reaches its marker under concurrent load

## Problem

`v2/src/persistence/state-store-wal-concurrency.test.ts` ("second writer on separate connection commits without database is locked") spawns `bun --eval` as a lock holder and awaits `jarvis-lock-held`. The child intermittently exits before the marker under concurrent load (CI run 35172007671 on PR #3954; a local `test:v2` gate on 2026-09-17, passing 4/4 in isolation).

The cause is not yet known. Since `subprocess-marker-rejection-carries-cause` landed (#4097), the next occurrence rejects with the child's exit code, signal, and a bounded stderr tail — so the evidence now arrives on its own.

## Not startable yet

This intent is **evidence-gated and must not be planned or dispatched until a captured rejection exists.** Hunting the flake is operator work, not implement work: it needs repeated full-suite runs on a quiet machine, which no implement run can perform or tick. A spec written before the evidence lands either guesses a cause — which the parent seed forbids — or encodes an unfalsifiable sweep, which strands the lane at no-progress. Plan PR #4100 was rejected on exactly that.

Start it when, and only when, an operator pastes a real captured rejection (exit code, signal, stderr tail, and the run it came from) into this file.

## Behavior

With the captured cause in hand: record it in a comment above the lock-holder spawn, and change the lock-holder script or its spawn setup to remove it. The WAL/busy-timeout assertions are unchanged.

The regression test forces the identified cause through the spawn setup and fails against the pre-fix lock holder. If that cause genuinely cannot be forced deterministically, the spec says so in its decisions and names the technical barrier there — operator-reviewable at plan time, never self-declared in a code comment at implement time.

## Prerequisites

- Landed: `subprocess-marker-rejection-carries-cause` (#4097). `waitForStdoutMarker` rejections carry the child's exit code, signal, and stderr tail.
- A captured rejection recorded above, from a real occurrence.
