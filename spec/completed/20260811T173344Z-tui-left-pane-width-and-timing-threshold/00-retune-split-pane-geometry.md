# Retune split-pane geometry

## Problem

The 38–40% left-pane clamp yields only 76 columns at a 200-column terminal, leaving neither pane at the intended ordinary-terminal balance.

## Decision ledger

- Set the left-pane floor to 80 columns, base to 45%, and ceiling to 50%. At zero divider offset, 180/200/245 columns yield left/right widths of 81/99, 90/110, and 111/134 respectively; this gives the left pane room for its 80-column timing floor without silently starving the right pane.
- Keep the 120-column stacked threshold, two-column divider nudge, right-pane derivation, and four-row dock unchanged. Rules out reworking layout modes or pane/dock semantics.

## Task checklist

- Retune the floor, base fraction, and ceiling fraction in `v2/src/tui/tui-shell-layout.ts`.
- Update shell-layout tests for ordinary and wide left/right widths, floor, ceiling, and unchanged stacked/nudge behavior.
- Update the geometry entries in durable docs.

## Acceptance criteria

- [x] `v2/src/tui/tui-shell-layout.test.ts` test `ordinary and wide terminals use the retuned left-pane clamp` fails against the pre-fix code and proves zero-offset split widths of left/right 81/99 at 180 columns, 90/110 at 200, and 111/134 at 245; it also proves the 80-column nudge floor, 50% nudge ceiling, and base no greater than ceiling.
- [x] `v2/src/tui/tui-shell-layout.test.ts` — `ordinary and wide terminals use the retuned left-pane clamp`; Keystone checkpoint: an in-body `// @mutate v2/src/tui/tui-shell-layout.ts "const LEFT_BASE_FRACTION = 0.45;" -> "const LEFT_BASE_FRACTION = 0.38;"` directive turns the scoped test red.
- [x] `v2/src/tui/tui-shell-layout.test.ts` — `ordinary and wide terminals use the retuned left-pane clamp`; Mutation checkpoint: in-body `// @mutate v2/src/tui/tui-shell-layout.ts "const LEFT_FLOOR = 80;" -> "const LEFT_FLOOR = 72;"` and `// @mutate v2/src/tui/tui-shell-layout.ts "const LEFT_CEILING_FRACTION = 0.5;" -> "const LEFT_CEILING_FRACTION = 0.4;"` directives each turn the scoped test red.
- [x] `v2/src/tui/tui-shell-layout.test.ts` tests `width 119 is stacked and width 120 is split` and `each nudge moves dividerOffset and left width by exactly 2 when unclamped` stay green.
- [x] `v2/src/tui/tui-monitor-lines.test.ts` tests `stacked detail uses the full terminal width` and `projects exactly four ordered dock rows from one state snapshot` stay green.

## Documentation updates

- `v2/docs/operator-runbook.md` Observe section: replace the deferred 38–40% clamp note with the 80-column floor and 45–50% clamp, including the ordinary-terminal left/right outcome.
- `v2/docs/v1-behaviors.md`: update the existing TUI parity entry with the changed split geometry.

## Blocker

`bun run test:v2` remains red because `v2/src/tui/tui-ink-monitor.test.tsx` still asserts the replaced 72-column floor and `v2/src/tui/tui-entry.test.tsx` still asserts compact timing at the newly 111-column-wide 245-column fixture. Patch Mode forbids editing these files because the subspec does not name them; the two focused tests reproduce deterministically.
