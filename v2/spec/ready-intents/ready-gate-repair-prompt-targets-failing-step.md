---
name: ready-gate-repair-prompt-targets-failing-step
---

# Ready-gate repair prompt targets the failing gate step

## Prerequisites

- Ready-gate repair fence reverts refused out-of-diff edits and settles an entirely out-of-diff refusal non-resumable.

## Behavior

The ready-gate repair prompt names the red gate step(s) and passes only their output, not the whole gate log, so repair fixes the failing step (e.g. `guard-dead-exports` on an in-diff file, #3951) instead of editing out-of-diff files for non-failing warnings.

## Acceptance criteria

- [ ] Repair prompt construction includes the failing step name and its output and excludes passing steps' output, pinned by a test failing against the whole-log prompt.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — ready-gate repair entry: repair is scoped to the failing step's output.
- `v2/docs/v1-behaviors.md` — record.
