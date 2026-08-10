# Build attention row projection

## Problem

The monitor has durable gate and failure facts but no projection that identifies, orders, and caps work needing operator attention.

## Decision ledger

- Add a pure `tui-attention-rows.ts` projection over canonical pipeline snapshots and daemon run rows; it owns source filtering, incident cardinality, stable identities, ordering, and the six-row cap plus overflow metadata. Rules out renderer-owned policy.
- Reconcile duplicate pipeline snapshots before projection: source paths are read in the existing ascending socket-path precedence and the first snapshot for a pipeline id is canonical; discard later duplicate ids, regardless of their contradictory state. Rules out duplicate or stale incidents.
- Emit one row per incident: each awaiting gate, rejected gate, failed stage, failed run, blocked run, and terminal-publication failure. A failed stage and each failed constituent run are separate incidents; multiple failed ad-hoc runs may share a group target but retain distinct row ids. Ignore skipped, interrupted, killed, budget-soft-stopped, and other statuses. Rules out treating every non-success state as attention.
- Carry row kind, separately namespaced selectable id, target tree node id, nullable `sinceMs`, glyph, `what`, and `where`; gate rows also retain pipeline, stage, and branch identity for the queued act-in-place consumer. Rules out parsing display copy or node ids during later command dispatch.
- Target gates and failed stages at their stable stage node, publication failures at the pipeline node, attributed runs at their stable run node, and ad-hoc workflow runs at the existing group node selected by the tree model. Rules out a second target namespace or detail model.
- Render-facing copy uses `✋` for either gate kind and `✗` for failures, stage id for stage-backed `what`, existing workflow-role labeling for run `what`, pipeline seed slug plus `›` stage fan-out `branchKey` for pipeline-backed `where`, and the established ad-hoc label otherwise. Rules out conflating pipeline fan-out with daemon Git branches or duplicating full work-tree rows.
- Awaiting-gate `sinceMs` is the nearest lower-position predecessor on its effective branch path, preferring the same branch and then its shared `default` predecessor: use a workflow predecessor's durable `endedAt`, an approval predecessor's durable `decidedAt`, and `null` when no predecessor or durable finish exists. Rules out snapshot-array adjacency or pipeline creation time.
- Rejected-gate `sinceMs` is `decidedAt`, failed-stage `sinceMs` is `endedAt`, and failed/blocked-run `sinceMs` is `finishedAtMs`. Publication failure uses only the durable pipeline terminal finish derived from terminal stage `endedAt` or approval `decidedAt`; it is `null` when no such terminal timestamp exists and never reads a `finishedAtMs` fallback to `createdAt`. Rules out admission time, refresh time, display-clock fabrication, or creation-time terminal failure ages.
- Sort gates before failures; within each group sort dated rows by ascending `sinceMs`, then undated rows by target node id, then stable attention row id. Rules out old failures displacing gates or tied/shared-target legacy rows consuming cap slots nondeterministically.
- Cap after sorting at six selectable rows and report the remaining count separately; retain all uncapped rows only as projection input to the total/overflow calculation. Rules out renderer-side truncation or selectable overflow rows.
- Recompute solely from retained snapshots and run rows with no dismissal state. Rules out a clear command or session-local pin retention.

## Task checklist

- Add the structured attention projection and deterministic identity/target helpers under `v2/src/tui/`.
- Reuse existing canonical snapshot reconciliation, tree identity, pipeline label, workflow grouping, and role-label helpers rather than reproducing their contracts.
- Add `v2/src/tui/tui-attention-rows.test.ts` fixtures for every source, incident cardinality, attribution mode, contradictory snapshots, predecessor kinds, timestamps, ordering ties, cap boundary, overflow count, namespacing, and legacy missing timestamps.
- Add in-body `// @mutate` directives for the headline source projection and every added source, timestamp, ordering, filtering, and cap guard.

## Acceptance criteria

- [ ] `tui-attention-rows.test.ts` test `builds every attention incident with durable targets and timestamps` fails against the pre-fix code and covers awaiting gate, rejected gate, failed stage, failed run, blocked run, and terminal-publication failure.
- [ ] Awaiting-gate age uses a workflow predecessor's `endedAt` or an approval predecessor's `decidedAt`; rejected-gate, stage-failure, and run-failure ages use `decidedAt`, `endedAt`, and `finishedAtMs` respectively; publication failure uses only a durable terminal-stage timestamp.
- [ ] A legacy failed or blocked run without `finishedAtMs` remains projected with `sinceMs: null`; no admission or display timestamp is substituted.
- [ ] A terminal-publication failure without a durable terminal-stage timestamp remains projected with `sinceMs: null`; pipeline `createdAt` and a fallback `finishedAtMs` never supply its age.
- [ ] Contradictory duplicate snapshots for one pipeline project incidents from only the first canonical source in ascending socket-path precedence; a later stale source contributes no row.
- [ ] A failed stage and its failed constituent run both count as rows; multiple failed ad-hoc runs may share one target but have distinct stable attention ids, and total, cap, and overflow count every incident.
- [ ] Seven actionable incidents project six selectable rows plus overflow count one; gates precede failures, dated rows are oldest first within each group, and equal timestamps and targets resolve by attention id at the cap boundary.
- [ ] Attention ids are stable and separately namespaced from target ids; pipeline-backed `where` uses `branchKey`, ad-hoc `where` uses its established label, and overflow metadata has no selectable id or target.
- [ ] `tui-attention-rows.test.ts` — `builds every attention incident with durable targets and timestamps`; Keystone checkpoint: an in-body `// @mutate` directive disables the complete attention projection and turns the scoped test red.
- [ ] `tui-attention-rows.test.ts` — `sorts undated rows after dated attention`; Mutation checkpoint: in-body `// @mutate` directives invert the dated-before-undated guard, target-id tie-break, and row-id tie-break, and each turns the scoped test red.
- [ ] `tui-attention-rows.test.ts` — `filters and caps attention sources`; Mutation checkpoint: in-body `// @mutate` directives invert every added source, canonical-source suppression, predecessor-kind timestamp, terminal-publication durability, filtering, and cap guard, including suppressed-effect negatives, and each turns the scoped test red.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — this subspec adds an internal projection; the painted consumer and durable operator documentation land in 02.
