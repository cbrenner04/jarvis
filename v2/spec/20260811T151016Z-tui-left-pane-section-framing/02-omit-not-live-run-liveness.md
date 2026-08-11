# Omit not-live run liveness

## Problem

Every work-tree run or ad-hoc row with `isLive === false` currently paints `idle` beside its durable status. That includes terminal and paused/not-live rows, producing a false liveness atom.

## Decision ledger

- Paint the liveness atom only when `isLive === true`, using the existing `live` label and tone. Every `isLive === false` run or ad-hoc row contributes no liveness atom. Rules out `idle` and any replacement terminal or paused liveness word.
- Keep durable status, elapsed time, width degradation, labels, and non-run rows unchanged. Rules out a row-composer or geometry redesign.

## Task checklist

- Change the run-row input in `v2/src/tui/tui-monitor-lines.ts` so every not-live run/ad-hoc row omits liveness while live rows retain `live`.
- Add a focused `v2/src/tui/tui-monitor-lines.test.ts` test covering live, terminal not-live, paused not-live, and ad-hoc not-live rows; update affected Ink tone expectations without weakening live-tone coverage.
- Add in-body `// @mutate` directives that restore baseline `idle` for a not-live row and invert the live-only condition.
- Update durable docs listed below.

## Acceptance criteria

- [ ] `tui-monitor-lines.test.ts` test `omits liveness for every not-live run or ad-hoc row while retaining live liveness` fails against the pre-fix code and proves terminal, paused, and ad-hoc `isLive === false` rows retain status and elapsed values but contain no liveness atom, while a live row still contains toned `live`.
- [ ] `tui-shell-layout.test.ts` tests `composes fill-width labels and per-kind clusters`, `drops optional cluster atoms before shrinking the label`, `run-row elapsed uses createdAt through finishedAtMs or nowMs`, and `a run row leads with its role and follows with the short run id` stay green.
- [ ] `tui-monitor-lines.test.ts` — `omits liveness for every not-live run or ad-hoc row while retaining live liveness`; Keystone checkpoint: an in-body `// @mutate` directive restores the baseline `idle` atom for a not-live row and turns the scoped test red.
- [ ] `tui-monitor-lines.test.ts` — `omits liveness for every not-live run or ad-hoc row while retaining live liveness`; Mutation checkpoint: an in-body `// @mutate` directive inverts the live-only liveness condition and turns the scoped test red, including the no-liveness assertions for every not-live state.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` Observe section: state that only live run rows paint `live`; terminal, paused, and every other not-live run/ad-hoc row paints no liveness atom.
- `v2/docs/v1-behaviors.md`: update the existing TUI run-row behavior to remove `idle` from every not-live state and retain live `live`.

## Implementer notes

- Use a unique one-line conditional in the `buildTreeRunRow` input as the mutation anchor. The keystone must restore baseline `idle`; the guard mutation must invert which liveness state emits `live`. Do not add test-only inversion hooks.
