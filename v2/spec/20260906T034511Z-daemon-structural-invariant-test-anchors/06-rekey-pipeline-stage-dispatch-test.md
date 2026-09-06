# Re-key pipeline-stage-dispatch.test.ts

## Problem

Row `dm-pipe-dispatch-ended-at-ast` in `v2/docs/structural-invariant-test-audit.md` pins terminal `store.updateStage` writes to a hand-maintained `CLASSIFIED_STATUS_WRITES` identity registry, so new terminal writes that carry `endedAt` red-gate until the test map is manually updated.

## Decision ledger

- Terminal stage-run write inventory is derived from AST discovery over the classified production source set with semantic identity keys, classifying terminal vs nonterminal by whether `endedAt` is present on the write; rules out hand-maintained map equality as the oracle.
- Classified source paths resolve from a discovered glob over dispatch owners, not a hardcoded two-file array; rules out red-gates when writes move to a sibling module in the dispatch chain.

## Task checklist

- [ ] Re-key audit row `dm-pipe-dispatch-ended-at-ast` per the decision ledger.
- [ ] Replace `CLASSIFIED_STATUS_WRITES` map equality with property assertions over AST-discovered terminal writes and `endedAt` presence.

## Acceptance criteria

- [ ] `pipeline-stage-dispatch.test.ts` test `every terminal pipeline stage-run write carries endedAt` derives classified status writes from AST discovery and asserts `endedAt` on terminal writes by property, not equality against hand-maintained `CLASSIFIED_STATUS_WRITES`; it fails against the pre-fix map equality pin on audit row `dm-pipe-dispatch-ended-at-ast` and passes after re-key.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
