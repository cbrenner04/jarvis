# Prove execution-loop human-only contracts

## Problem

- `implement.already_complete` and `spec.criteria-ticked` consume `parseSpec(...).humanOnly`, but
  their regressions do not exercise a marker on a wrapped continuation line.
- Pre-fix misclassification treats that unchecked human-only criterion as runnable work: implement
  admits a no-op run instead of returning `implement.already_complete`, and terminal write returns
  `contract_miss`. Parser-only coverage does not prove the corrected contracts.

## Decisions

- Keep both consumer filters parseSpec-driven and unchanged — rules out duplicate human-only
  classifiers in the execution loop.
- Use a six-space-indented continuation-line `(Manual)` criterion as the only unchecked item in
  both regressions — rules out same-line fixtures and parser-unit-only proof.
- Expect launch to reject the otherwise complete tree and terminal write to complete — rules out
  treating unchecked human verification as runnable automated work.
- Add no production guard; pin each unchanged consumer filter with a source-mutation directive in
  its regression — rules out production invert hooks and untested filter polarity.
- The parser prerequisite recognizes each exact marker string as a case-insensitive contiguous
  substring anywhere in an assembled criterion block; marker-boundary variants remain parser-owned.
- Update the v2 workflow and operator docs only. Injected write-step guidance and
  `v1/docs/run-loop.md` retain trailing-marker semantics; their parser-classification sibling owns
  reconciliation and must land first, so this execution-loop spec remains serially sequenced after it.

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

- [x] `implement-workflow-steps.test.ts` — `rejects an already-complete linked tree with only a
      wrapped human-only criterion unchecked` uses `(Manual)` on a six-space continuation line as
      the only unchecked item and returns `implement.already_complete`; it fails with the pre-fix
      parser and passes with block-aware classification.
- [x] `write.test.ts` — `done completes when only a wrapped human-only criterion is unchecked` uses
      the same wrapped shape and returns `complete`, not `contract_miss`; it fails with the pre-fix
      parser and passes with block-aware classification.
- [x] `implement-workflow-steps.test.ts` — Mutation checkpoint: its regression carries an `@mutate`
      directive that inverts the `implement.already_complete` production `humanOnly` filter and turns
      the named test red; production guards and production test hooks remain unchanged.
- [x] `write.test.ts` — Mutation checkpoint: its regression carries an `@mutate` directive that
      inverts the `spec.criteria-ticked` production `humanOnly` filter and turns the named test red;
      production guards and production test hooks remain unchanged.
- [x] `v2/docs/workflow-runner.md` documents that each exact human-only marker is a
      case-insensitive contiguous substring matched anywhere in an assembled criterion bullet block.
- [x] `v2/docs/operator-runbook.md` removes the obsolete wrapped-`(Manual)` known issue and
      workaround.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — human-only markers match at any position on any line of the full
  criterion bullet block as case-insensitive contiguous exact-marker substrings, not only the first
  line or text tail.
- `v2/docs/operator-runbook.md` — remove the obsolete wrapped-`(Manual)` known issue and workaround.
- Deferred to the parser-classification prerequisite sibling after it lands: reconcile injected
  write-step guidance and `v1/docs/run-loop.md`, which retain trailing-marker semantics.
