# Frame Queue section

## Problem

Queued work is introduced by a bare `Queue` label, so it does not match the ruled attention framing and runs into the Work section.

## Decision ledger

- Paint `── Queue (N) ──` before queued rows, where `N` is the queued-row count. Rules out retaining the bare label or counting non-queued runs.
- Suppress Queue only when there are no queued rows. Rules out an empty framing row consuming pane height.
- Keep queued rows oldest-first with their admission descriptor, after the Work tree, and add no spacer. Rules out queue ordering, content, or layout changes.

## Task checklist

- Change the Queue heading in `v2/src/tui/tui-monitor-lines.ts` and retain the existing non-empty queue projection.
- Add focused pure-builder and Ink consumer tests in `v2/src/tui/tui-monitor-lines.test.ts` and `v2/src/tui/tui-ink-monitor.test.tsx`.
- Add in-body `// @mutate` directives for the ruled Queue headline and empty-Queue suppression.
- Update durable docs listed below.

## Acceptance criteria

- [ ] `tui-monitor-lines.test.ts` test `renders ruled Queue heading only for queued rows` fails against the pre-fix code and proves Queue reports its queued-row count, an empty queue paints no heading, and queued rows remain oldest-first with the admission descriptor.
- [ ] `tui-ink-monitor.test.tsx` test `renders ruled Queue framing in the left pane` fails against the pre-fix code and proves the actual consumer paints Queue after Work/tree rows with no blank spacer.
- [ ] `tui-monitor-lines.test.ts` — `renders ruled Queue heading only for queued rows`; Keystone checkpoint: an in-body `// @mutate` directive restores the bare `Queue` headline and turns the scoped test red.
- [ ] `tui-monitor-lines.test.ts` — `renders ruled Queue heading only for queued rows`; Mutation checkpoint: an in-body `// @mutate` directive disables empty-Queue suppression and turns the scoped test red.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` Observe section: describe the ruled Queue heading, its queued-row count, empty-state omission, and heading-only separation after Work.
- `v2/docs/v1-behaviors.md`: update the existing TUI Queue behavior to record the ruled heading while retaining row order and admission detail.

## Implementer notes

- Target the unique production headline expression for the keystone and the existing empty-Queue return for the guard. Do not add test-only inversion hooks.
