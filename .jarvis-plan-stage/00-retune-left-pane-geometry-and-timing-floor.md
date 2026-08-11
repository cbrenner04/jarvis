# Retune left-pane geometry and timing floor

## Problem

The 38–40% left-pane clamp and 100-column labeled-timing floor combine to hide `work <duration> · idle <duration>` at ordinary 180–200-column terminals.

## Decision ledger

- Set the left-pane floor to 80 columns, base to 45%, and ceiling to 50%; zero-offset widths are 81 at 180 terminal columns, 90 at 200, and 111 at 245. Rules out preserving the right-heavy 38–40% split that makes work-state labels cryptic at ordinary widths.
- Use one shared 80-column labeled-timing floor for pipeline, branch, and stage rows; widths below 80 use compact timing. Rules out three duplicated thresholds drifting and rules out labeled cells at widths too narrow for their 20-column budget.
- Preserve compact `w<duration>/i<duration>` rendering and `w<duration>/i…` overflow below 80 columns. Rules out deleting the narrow-terminal fallback.
- Keep the 120-column stacked threshold, two-column divider nudge, right-pane derivation, four-row dock, section framing, and row content unchanged. Rules out a broader shell-layout or monitor-row redesign.

## Task checklist

- Retune the floor, base fraction, and ceiling fraction in `v2/src/tui/tui-shell-layout.ts`.
- Route the pipeline, branch, and stage compact decisions in `v2/src/tui/tui-monitor-pipeline-tree.ts` through one 80-column threshold guard.
- Update shell-layout tests for ordinary, wide, floor, ceiling, and unchanged stacked/nudge behavior.
- Update timing tests to pass actual 180-column zero-offset geometry into pipeline and branch rows, pin the 80-column boundary, and retain compact overflow coverage below it.
- Align affected TUI integration expectations and comments with the new geometry and labeled timing without changing display-tick, divider, section, right-pane, or dock semantics.
- Add the in-body mutation directives described below and update the durable docs.

## Acceptance criteria

- [ ] `v2/src/tui/tui-shell-layout.test.ts` test `ordinary and wide terminals use the retuned left-pane clamp` fails against the pre-fix code and proves zero-offset left widths 81 at 180 columns, 90 at 200, and 111 at 245, an 80-column nudge floor, a 50% nudge ceiling, base no greater than ceiling, and the unchanged 120-column stacked boundary and two-column nudge.
- [ ] At 180 terminal columns and zero divider offset, pipeline and branch rows paint `work 1m · idle 1m` in the 81-column left pane rather than `w1m/i1m`; `v2/src/tui/tui-monitor-pipeline-tree.test.ts` test `ordinary split geometry renders labeled pipeline and branch timing` fails against the pre-fix code and passes after the coupled retune.
- [ ] Width 80 paints the 20-column labeled timing cell; width 79 paints the eight-column compact cell, including `w1m/i1m` when it fits and `w59m/i…` when the pair overflows.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `ordinary split geometry renders labeled pipeline and branch timing`; Keystone checkpoint: an in-body `// @mutate` directive reverting the shared threshold guard from 80 to 100 turns the scoped test red.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` — `timing width boundary keeps the narrow compact fallback`; Mutation checkpoint: an in-body `// @mutate` directive inverting the shared `< 80` compact guard turns the scoped test red, proving both sides of the boundary.
- [ ] `v2/src/tui/tui-monitor-pipeline-tree.test.ts` tests `the compact timing cell elides idle instead of right-clipping work when the paired form overflows` and `the compact timing cell keeps full work and elides idle when the paired form overflows` stay green after their compact fixture widths move below 80 (overflow behavior unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` Observe section: replace the deferred 38–40%/100-column note with the 80-column floor, 45–50% clamp, 80-column labeled-timing floor, ordinary-terminal outcome, and compact fallback below it.
- `v2/docs/v1-behaviors.md`: update the existing TUI parity entry with the same changed geometry and timing boundary.

## Implementer notes

- Give the shared threshold guard one stable, unique source line. Put `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return leftPaneWidth < 80;" -> "return leftPaneWidth < 100;"` inside `ordinary split geometry renders labeled pipeline and branch timing` and `// @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return leftPaneWidth < 80;" -> "return leftPaneWidth >= 80;"` inside `timing width boundary keeps the narrow compact fallback`; adjust the quoted original only if the implementation names a constant, while keeping a unique real-guard anchor and the same mutations.
- Do not add test-only inversion hooks.
