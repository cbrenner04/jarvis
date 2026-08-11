# Omit terminal run liveness

## Problem

A not-live work-tree run paints the liveness atom `idle` beside its durable terminal status, producing contradictory rows such as `completed … idle`.

## Decision ledger

- Paint the liveness atom only for live run/ad-hoc rows, using the existing `live` label and tone; a not-live row contributes no liveness atom. Rules out retaining `idle` or inventing a terminal-liveness replacement.
- Keep durable status, elapsed time, width degradation, labels, and every non-run row unchanged. Rules out treating this semantic cleanup as a row-composer or geometry redesign.

## Task checklist

- Change the run-row input in `v2/src/tui/tui-monitor-lines.ts` so terminal run/ad-hoc rows omit the liveness atom while live rows retain `live`.
- Add a focused `v2/src/tui/tui-monitor-lines.test.ts` test covering both liveness states and update affected Ink tone expectations without weakening live-tone coverage.
- Add in-body `// @mutate` directives that restore baseline terminal `idle` semantics and invert live-only emission.
- Update durable docs listed below.

## Acceptance criteria

- [ ] `tui-monitor-lines.test.ts` test `omits terminal liveness while retaining live liveness` fails against the pre-fix code and proves a terminal run/ad-hoc row contains its status and elapsed value but no `idle` liveness atom, while a live row still contains toned `live`.
- [ ] `tui-shell-layout.test.ts` tests `composes fill-width labels and per-kind clusters`, `drops optional cluster atoms before shrinking the label`, `run-row elapsed uses createdAt through finishedAtMs or nowMs`, and `a run row leads with its role and follows with the short run id` stay green.
- [ ] `tui-monitor-lines.test.ts` — `omits terminal liveness while retaining live liveness`; Keystone checkpoint: an in-body `// @mutate` directive restores the terminal `idle` atom and turns the scoped test red.
- [ ] `tui-monitor-lines.test.ts` — `omits terminal liveness while retaining live liveness`; Mutation checkpoint: an in-body `// @mutate` directive inverts the live-only liveness condition and turns the scoped test red, including the negative assertion that terminal rows contain no liveness atom.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` Observe section: state that live run rows paint `live` and terminal run rows paint no liveness atom.
- `v2/docs/v1-behaviors.md`: update the existing TUI run-row behavior to remove terminal `idle` and retain live `live`.

## Implementer notes

- Use a unique one-line conditional in the `buildTreeRunRow` input as the mutation anchor. The keystone should replace the terminal empty atom with baseline `idle`; the guard mutation should invert which liveness state emits `live`. Do not add test-only inversion hooks.
