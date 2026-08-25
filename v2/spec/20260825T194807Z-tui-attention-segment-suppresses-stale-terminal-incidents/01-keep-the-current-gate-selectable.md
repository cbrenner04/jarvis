# 01 - Keep the current gate rendered and selectable

## Problem

Gates and failures share one six-row cap and sort oldest-`sinceMs`-first within the gate group, so with seven-plus awaiting gates — abandoned dogfood pipelines from prior phases — six ancient gates fill the cap and the operator's current gate lands in the display-only, non-selectable `+N more`; because the dock `approve` verb takes no id and acts only on the selected row, that gate cannot be approved from the TUI at all.

## Decision ledger

- Gate rows are exempt from `ATTENTION_ROW_CAP`; the cap bounds only failure rows, and `overflow` becomes the dropped-failure count; rules out a shared cap, under which an unresolved gate is unreachable by any TUI action.
- Within the gate group, dated rows sort newest-reached first (`GATE_KINDS.has(a.kind) ? -sinceDelta : sinceDelta`); rules out leaving oldest-first, which buries the current gate below a stale backlog once the pane clips the segment at pane height.
- Failures keep gates-before-failures grouping and oldest-idle-first ordering; rules out reorienting both groups from one comparator edit.
- Undated gates keep sorting after dated gates, then by target id and row id; rules out a second ordering change with no observed motivation.
- `total` stays the surfaced-incident count and `overflow` stays `total - rows.length`, so the heading and `+N more` arithmetic is unchanged; rules out a separate failure-only counter in the paint layer.
- Left-pane reservation continues to derive from the projected row count, so a large gate set shrinks the tree viewport to its existing zero floor and Ink clips the segment prefix as it does today; rules out a second height cap that would reintroduce hidden gates.

## Task checklist

- [ ] In `v2/src/tui/tui-attention-rows.ts`, split the sorted surfaced incidents into `gates` and `failures` by `GATE_KINDS` and build `rows` as every gate followed by `failures.slice(0, ATTENTION_ROW_CAP)`, leaving `total` and `overflow` derived as they are today.
- [ ] In `compareAttentionRows`, orient the same-group dated comparison by group so gates compare newest-first and failures stay oldest-first, leaving group rank, undated placement, and the target-id/row-id tiebreaks untouched.
- [ ] Pin uncapped gates, newest-gate-first ordering, the failure-ordering negative case, and the retained failure cap in `v2/src/tui/tui-attention-rows.test.ts`, each with an in-body directive on the real guard (no production inversion hooks).
- [ ] Pin in `v2/src/tui/tui-entry.test.tsx` that `approve` reaches the newest gate when the gate backlog exceeds the failure cap.
- [ ] Update the durable docs listed below in the same change.

## Acceptance criteria

- [ ] `v2/src/tui/tui-attention-rows.test.ts` — `every awaiting gate stays selectable when gates exceed the failure cap`; Keystone checkpoint: seven awaiting gates all project into `rows` with `overflow` zero, the test fails against the pre-fix shared six-row cap, and an in-body directive restoring that shared cap (`const rows = [...gates, ...failures.slice(0, ATTENTION_ROW_CAP)];` replaced by `const rows = incidents.slice(0, ATTENTION_ROW_CAP);`) turns the scoped test red.
- [ ] `v2/src/tui/tui-attention-rows.test.ts` — `the newest awaiting gate sorts ahead of a stale gate backlog`; Mutation checkpoint: the most-recently-reached gate is the first projected row ahead of six older gates, and an in-body directive reverting gate orientation (`const oriented = GATE_KINDS.has(a.kind) ? -sinceDelta : sinceDelta;` replaced by `const oriented = sinceDelta;`) turns the scoped test red.
- [ ] `v2/src/tui/tui-attention-rows.test.ts` — `failures still sort oldest-idle-first behind every gate`; Mutation checkpoint: the negative case proves the gate orientation did not leak into the failure group, and an in-body directive reorienting failures (`const oriented = GATE_KINDS.has(a.kind) ? -sinceDelta : sinceDelta;` replaced by `const oriented = -sinceDelta;`) turns the scoped test red.
- [ ] `v2/src/tui/tui-attention-rows.test.ts` — `failures beyond the cap stay in display-only overflow`; Mutation checkpoint: seven surfaced failures leave six failure rows with `overflow` reporting the remainder and no id for the dropped row, and an in-body directive dropping the failure cap (`const rows = [...gates, ...failures.slice(0, ATTENTION_ROW_CAP)];` replaced by `const rows = [...gates, ...failures];`) turns the scoped test red.
- [ ] `v2/src/tui/tui-entry.test.tsx` — `approve reaches the newest gate behind a stale gate backlog`: with more awaiting gates than the failure cap, the newest gate's attention id is in the selectable set, selecting it and issuing `approve` dispatches `pipeline_approve` for that gate's `pipelineId`/`stageId`/`branchKey`, and the test fails against the pre-fix projection where that id is not selectable.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` attention-segment paint and left-pane reservation tests stay green (heading, `+N more`, and tree-budget arithmetic unchanged by the split cap).
- [ ] `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md` state that every unresolved gate renders and is selectable, gates paint newest-reached first, and the six-row cap and `+N more` overflow now bound failures only.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the needs-attention segment paragraph: gates are uncapped and paint newest-reached first ahead of failures, so the current gate is always the first row and always selectable for `approve`/`reject`; the six-row cap and the display-only `+N more` line now apply to failure rows only.
- `v2/docs/v1-behaviors.md` — update the `buildAttentionRows` projection entry and the attention-segment paint entry to record gate-uncapped membership, newest-first gate ordering, failures-only capping, and the resulting overflow semantics as current v2 behavior.
