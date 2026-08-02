# Prove execution-loop human-only contracts

## Problem

- `implement.already_complete` and `spec.criteria-ticked` consume `parseSpec(...).humanOnly`, but
  their regressions do not exercise a marker on a wrapped continuation line.
- Parser-only coverage does not prove implement launch and terminal-write contracts avoid
  `already_complete` and `contract_miss` stranding.

## Decisions

- Keep both consumer filters parseSpec-driven and unchanged — rules out duplicate human-only
  classifiers in the execution loop.
- Use a six-space-indented continuation-line `(Manual)` criterion as the only unchecked item in
  both regressions — rules out same-line fixtures and parser-unit-only proof.
- Expect launch to reject the otherwise complete tree and terminal write to complete — rules out
  treating unchecked human verification as runnable automated work.
- Add no production guard; pin each unchanged consumer filter with a source-mutation directive in
  its regression — rules out production invert hooks and untested filter polarity.
- Document marker placement in `workflow-runner.md` and delete the obsolete runbook workaround —
  rules out contradictory operator guidance.

## Tasks

- Update `implement-workflow-steps.test.ts` so the linked-tree completion regression leaves only a
  wrapped `(Manual)` criterion unchecked and expects `implement.already_complete`.
- Update `write.test.ts` so a `done` implement write with only that wrapped criterion unchecked
  completes instead of `contract_miss`.
- Add `@mutate` comments in both regressions that invert their consumer's `humanOnly` filter.
- Update `v2/docs/workflow-runner.md` with full-bullet, position-independent human-only matching.
- Remove the shipped wrapped-marker known issue from `v2/docs/operator-runbook.md`.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `implement-workflow-steps.test.ts` — `rejects an already-complete linked tree with only a
      wrapped human-only criterion unchecked` uses `(Manual)` on a six-space continuation line as
      the only unchecked item and returns `implement.already_complete`; it fails with the pre-fix
      parser and passes with block-aware classification.
- [ ] `write.test.ts` — `done completes when only a wrapped human-only criterion is unchecked` uses
      the same wrapped shape and returns `complete`, not `contract_miss`; it fails with the pre-fix
      parser and passes with block-aware classification.
- [ ] `implement-workflow-steps.test.ts` and `write.test.ts` — Mutation checkpoint: each regression
      carries an `@mutate` directive that inverts its corresponding production `humanOnly` filter
      and turns the named test red; production guards and production test hooks remain unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — human-only markers match at any position on any line of the full
  criterion bullet block, not only the first line or text tail.
- `v2/docs/operator-runbook.md` — remove the obsolete wrapped-`(Manual)` known issue and workaround.
