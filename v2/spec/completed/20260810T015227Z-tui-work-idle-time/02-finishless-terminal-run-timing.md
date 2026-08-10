# Finishless terminal-run timing

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

A legacy terminal run without `finishedAtMs` falls through to the display clock and appears to keep running forever.

## Decision ledger

- A painted workflow row is active when any painted member is active and then ends at the display clock. A terminal group ends at the latest available member `finishedAtMs`; when none exists, it ends at the latest member `createdAt` admission timestamp.
- A standalone terminal row with no finish therefore has zero elapsed at its own admission timestamp, rather than blank elapsed or display-clock growth. Group elapsed begins at the earliest member `createdAt` and clamps corrupt/reversed values to zero.
- Run timing is best-effort for the currently painted group: capped or evicted members cannot contribute an unobserved finish or admission timestamp. Retained members still determine a stable terminal result.
- Replace the contradictory `finishless terminal run elapsed keeps advancing when nowMs advances` test in `v2/src/tui/tui-shell-layout.test.ts`; it asserts obsolete behavior.

## Prerequisites

- Current terminal daemon list rows project durable `finishedAtMs`; legacy terminal rows may omit it.

## Tasks

- Change workflow-row elapsed projection so terminal finishless groups use their explicit admission fallback while active groups retain display-clock timing.
- Cover standalone and grouped terminal rows, durable finishes, active members, corrupt boundaries, and capped-member best-effort behavior in `v2/src/tui/tui-shell-layout.test.ts` and `v2/src/tui/tui-monitor-pipeline-tree.test.ts`.
- Update the finishless-terminal portions of `v2/docs/operator-runbook.md` § Observe and `v2/docs/v1-behaviors.md` § TUI / observability.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `v2/src/tui/tui-shell-layout.test.ts` — `finishless terminal runs freeze at durable finish or admission fallback` replaces the contradictory baseline test, fails against the baseline, and proves active rows change across display clocks while terminal rows do not; grouped terminal rows use the latest retained `finishedAtMs`, no-finish groups use latest admission, standalone no-finish rows render `0s`, and corrupt boundaries clamp to zero.
- [x] `v2/src/tui/tui-shell-layout.test.ts` — `finishless terminal runs freeze at durable finish or admission fallback`; Keystone checkpoint: its test body carries `// @mutate v2/src/tui/tui-shell-layout.ts "const endMs = latestFinishedAtMs ?? latestCreatedAtMs;" -> "const endMs = latestFinishedAtMs ?? nowMs;"`, and the mutation turns the finishless-terminal regression RED.
- [x] `v2/src/tui/tui-shell-layout.test.ts` — `finishless terminal runs freeze at durable finish or admission fallback` carries `// @mutate v2/src/tui/tui-shell-layout.ts "if (workflowGroupHasActiveMember(members)) return null;" -> "if (false) return null;"`, and the mutation turns the active-row assertion RED.
- [x] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `terminal workflow timing is best effort for retained members` fails against the baseline and proves an evicted member cannot manufacture a finish while retained members still select their latest durable finish or admission fallback.
- [x] `v2/docs/operator-runbook.md` § Observe and `v2/docs/v1-behaviors.md` § TUI / observability record terminal finishless admission fallback, zero standalone elapsed, active display-clock timing, and capped-member best-effort semantics.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — terminal finishless freeze and admission fallback.
- `v2/docs/v1-behaviors.md` § TUI / observability — finishless terminal run and retention behavior.
