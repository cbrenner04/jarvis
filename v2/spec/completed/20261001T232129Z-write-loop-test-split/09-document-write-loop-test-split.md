# Document write-loop test split

## Problem

Operators and implement agents lack durable guidance for splitting an over-budget co-located suite by `describe` area with shared support and a missing-only inventory guard; the workflow-runner and resume splits set precedent but do not mention write-loop.

## Surface

Primary: `v2/docs/test-writing.md`.

## Prerequisites

- Subspec 08 complete: split siblings exist, inventory and cap guards pass, and scoped test gates are green.

## Decision ledger

- Document ~60 s serial per-file headroom as the split target under the unchanged 180 s `SUPPORTED_HEALTHY_FILE_BUDGET_MS` floor; rules out implying the 180 s ceiling is the design target for new co-located files.
- Reconcile the workflow-runner-resume split narrative in `test-writing.md` so the ~40 s historical trigger and this intent's ~60 s headroom read as one policy (~60 s idle serial target under the 180 s floor; split earlier when a co-located file approaches that headroom); rules out leaving conflicting per-file timing numbers in the same section.
- Document the pattern: shared `write-loop.test-support.ts`, missing-only `write-loop-test-inventory.test.ts`, describe-area siblings `write-loop-<area>.test.ts`, at-most-120 leaf tests per owned file; cite both the workflow-runner-resume split and this write-loop split; rules out duplicating the full inventory algorithm prose already in file headers.
- Note the 2026-10-01 load-sensitive join and its removal once split files clear headroom (cross-link `scripts/test-slice.ts` roster comment); rules out stale guidance that still tells operators to expect monolith isolation.

## Task checklist

- Update `v2/docs/test-writing.md` per the ledger (Load-sensitive / co-located split section).

## Acceptance criteria

- [x] `v2/docs/test-writing.md` documents the ~60 s headroom target (aligned with workflow-runner-resume language), support module + inventory guard + describe-area sibling pattern, and cites the workflow-runner-resume and write-loop splits.
- [x] `bun run typecheck` and `bun run check` pass.

## Documentation updates

- `v2/docs/test-writing.md` — per intent Documentation updates section.
