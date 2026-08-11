# Retune pipeline and branch timing

## Problem

The 100-column timing threshold selects cryptic compact timing even after the geometry retune makes an 80-column left pane available at ordinary terminal widths.

## Decision ledger

- Use one shared 80-column compact guard for pipeline and branch timing only. At 80 columns they use the 20-column labeled timing cell; below 80 they use the eight-column compact cell. Rules out duplicated pipeline/branch thresholds drifting.
- Do not change stage-row timing, section framing, or row-composition/degradation priorities. Rules out extending this pane-geometry change into unrelated row-content behavior.
- Preserve compact `w<duration>/i<duration>` rendering and `w<duration>/i…` overflow below 80 columns. Rules out deleting the narrow-terminal fallback.

## Task checklist

- Route pipeline and branch compact decisions in `v2/src/tui/tui-monitor-pipeline-tree.ts` through one 80-column threshold guard; leave stage timing on its current behavior.
- Add realistic pipeline and branch fixtures that use the zero-offset 180-column shell geometry and assert the painted timing atom is labeled when it fits.
- Update timing tests for the 80/79 boundary and retain compact-overflow coverage below 80.
- Add the in-body mutation directives described below.
- Align affected TUI integration expectations and comments only when values are directly caused by the geometry or timing-boundary retune.
- Update the timing entries in durable docs.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` test `ordinary split geometry renders labeled pipeline and branch timing` fails against the pre-fix code and, using realistic pipeline and branch content plus `computeShellLayout(180, ..., 0).leftWidth`, proves each painted row contains `work 1m · idle 1m` rather than `w1m/i1m`.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` test `timing width boundary keeps the narrow compact fallback` proves width 80 uses the 20-column labeled cell and width 79 uses the eight-column compact cell, including `w1m/i1m` when it fits and `w59m/i…` when it overflows.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `ordinary split geometry renders labeled pipeline and branch timing`; Keystone checkpoint: an in-body `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return leftPaneWidth < 80;" -> "return leftPaneWidth < 100;"` directive turns the scoped test red.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `timing width boundary keeps the narrow compact fallback`; Mutation checkpoint: an in-body `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return leftPaneWidth < 80;" -> "return leftPaneWidth >= 80;"` directive turns the scoped test red, proving both sides of the boundary.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` tests `the compact timing cell elides idle instead of right-clipping work when the paired form overflows` and `the compact timing cell keeps full work and elides idle when the paired form overflows` stay green after their compact fixture widths move below 80.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` tests `stage row elapsed is empty when startedAt is null` and `a collapsed stage omits only its runs while the stage row stays visible`, `v2/src/tui/tui-shell-layout.test.ts` `cluster degradation` tests, and `v2/src/tui/tui-monitor-lines.test.ts` tests `renders ruled Work heading from the full work model` and `Runs section still renders when only queued runs exist` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` Observe section: record the 80-column labeled-timing floor, the labeled ordinary-terminal outcome, and the compact fallback below it; remove the former 100-column/~250-terminal retune-follow-up note.
- `v2/docs/v1-behaviors.md`: update the existing TUI parity entry with the pipeline/branch 80-column timing boundary and unchanged stage behavior.

## Implementer notes

- Give the shared pipeline/branch threshold guard one stable, unique source line. Keep the two quoted directives above on that real guard; adjust only the quoted original if a named constant requires it.
- Do not add test-only inversion hooks.
