# Build attention row projection

## Problem

The monitor has durable gate and failure facts but no projection that identifies, orders, and caps work needing operator attention.

## Decision ledger

- Add a pure `tui-attention-rows.ts` projection over merged pipeline snapshots and daemon run rows; it owns source filtering, stable identities, ordering, and the six-row cap plus overflow metadata. Rules out renderer-owned policy.
- Emit one structured row for each awaiting gate, rejected gate, failed stage, failed run, blocked run, and terminal-publication failure; ignore skipped, interrupted, killed, budget-soft-stopped, and other statuses. Rules out treating every non-success state as attention.
- Carry row kind, separately namespaced selectable id, target tree node id, nullable `sinceMs`, glyph, `what`, and `where`; gate rows also retain pipeline, stage, and branch identity for the queued act-in-place consumer. Rules out parsing display copy or node ids during later command dispatch.
- Target gates and failed stages at their stable stage node, publication failures at the pipeline node, attributed runs at their stable run node, and ad-hoc workflow runs at the existing group node selected by the tree model. Rules out a second target namespace or detail model.
- Render-facing copy uses `✋` for either gate kind and `✗` for failures, stage id for stage-backed `what`, existing workflow-role labeling for run `what`, pipeline seed slug plus `›` branch for attributed `where`, and the existing ad-hoc label otherwise. Rules out duplicating full work-tree rows.
- Awaiting-gate `sinceMs` is the nearest lower-position predecessor finish on its effective branch path, preferring the same branch and then its shared `default` predecessor; no predecessor or no durable finish yields `null`. Rules out snapshot-array adjacency or pipeline creation time.
- Rejected-gate `sinceMs` is `decidedAt`, failed-stage `sinceMs` is `endedAt`, failed/blocked-run `sinceMs` is `finishedAtMs`, and publication-failure `sinceMs` is pipeline `finishedAtMs`; absent durable values remain `null`. Rules out admission time, refresh time, or display-clock fabrication.
- Sort gates before failures; within each group sort dated rows by ascending `sinceMs`, then undated rows by target node id. Rules out old failures displacing gates or legacy rows consuming cap slots nondeterministically.
- Cap after sorting at six selectable rows and report the remaining count separately; retain all uncapped rows only as projection input to the total/overflow calculation. Rules out renderer-side truncation or selectable overflow rows.
- Recompute solely from retained snapshots and run rows with no dismissal state. Rules out a clear command or session-local pin retention.

## Task checklist

- Add the structured attention projection and deterministic identity/target helpers under `v2/src/tui/`.
- Reuse existing tree identity, pipeline label, workflow grouping, and role-label helpers rather than reproducing their contracts.
- Add `v2/src/tui/tui-attention-rows.test.ts` fixtures for every source, attribution mode, timestamps, ordering, cap, overflow count, namespacing, and legacy missing timestamps.
- Add in-body `// @mutate` directives for the headline source projection and every added source, timestamp, ordering, filtering, and cap guard.

## Acceptance criteria

- [ ] `tui-attention-rows.test.ts` test `builds every attention source with durable targets and timestamps` fails against the pre-fix code and covers awaiting gate, rejected gate, failed stage, failed run, blocked run, and terminal-publication failure.
- [ ] Awaiting-gate age starts at its effective predecessor's `endedAt`, rejected-gate age at `decidedAt`, stage-failure age at `endedAt`, run-failure age at `finishedAtMs`, and publication-failure age at pipeline `finishedAtMs`.
- [ ] A legacy failed or blocked run without `finishedAtMs` remains projected with `sinceMs: null`; no admission or display timestamp is substituted.
- [ ] Seven actionable sources project six selectable rows plus overflow count one; gates precede failures and dated rows are oldest first within each group.
- [ ] Attention ids are stable and separately namespaced from target ids; overflow metadata has no selectable id or target.
- [ ] `tui-attention-rows.test.ts` — `builds every attention source with durable targets and timestamps`; Keystone checkpoint: an in-body `// @mutate` directive removes the awaiting-gate projection and turns the scoped test red.
- [ ] `tui-attention-rows.test.ts` — `sorts undated rows after dated attention`; Mutation checkpoint: in-body `// @mutate` directives invert the dated-before-undated guard and target-id tie-break, and each turns the scoped test red.
- [ ] `tui-attention-rows.test.ts` — `filters and caps attention sources`; Mutation checkpoint: in-body `// @mutate` directives invert every remaining added source, suppression, timestamp, and cap guard, including suppressed-effect negatives, and each turns the scoped test red.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — this subspec adds an internal projection; the first painted consumer and durable operator documentation land in 01.
