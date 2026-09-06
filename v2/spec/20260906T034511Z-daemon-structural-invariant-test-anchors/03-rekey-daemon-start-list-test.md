# Re-key daemon-start-list.test.ts

## Problem

Row `dm-startlist-terminal-settlement-guard` in `v2/docs/structural-invariant-test-audit.md` pins daemon terminal-writer inventory to regex captures over concatenated flat-directory sources and `indexOf` section bounds, so legitimate handler extractions and line drift red-gate or pass vacuously (`vacuous-pass-risk: yes`).

## Decision ledger

- Terminal and nonterminal writer inventory keys on semantic call-site identity derived from production sources, not regex equality over full `setRunStatus` argument strings; rules out line-drift and extraction red-gates.
- Daemon production sources are discovered by recursive glob under `v2/src/daemon/`, not `readdirSync(import.meta.dir)` of a single directory; rules out missing nested handler modules.
- Reconciliation admission bounds use `locateSymbolSlice`, not `indexOf` slicing that returns empty when the end anchor is absent; rules out vacuous pass when `finishRunReconciliation` moves.

## Task checklist

- [ ] Re-key audit row `dm-startlist-terminal-settlement-guard` per the decision ledger.
- [ ] Replace flat-directory production reads and regex inventory with semantic writer identities plus loud-failure symbol slicing.

## Acceptance criteria

- [ ] `daemon-start-list.test.ts` test `daemon production terminal writers are restricted to atomic settlement` keys terminal and nonterminal write inventory on semantic call-site identities discovered from the daemon production tree, not hand-maintained regex captures over concatenated sources; it fails against the pre-fix `.setRunStatus` regex equality pin on audit row `dm-startlist-terminal-settlement-guard` (`vacuous-pass-risk: yes`) and passes after re-key.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — patterns land in `v2/docs/test-writing.md` via a later intent.
