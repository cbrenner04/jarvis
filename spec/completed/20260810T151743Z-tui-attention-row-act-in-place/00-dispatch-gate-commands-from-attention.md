# Dispatch gate commands from attention

## Problem

`approve` and `reject` reject a selected attention id before reaching the gate identity already projected on that row.

## Decision ledger

- Resolve an attention gate from `AttentionRow.gate`, not by parsing its namespaced id or rediscovering its target stage. Rules out coupling dispatch to attention-id encoding.
- Admit `approve` and `reject` only for an `awaiting-gate` attention row; report `not_awaiting_stage` with no RPC for `rejected-gate`, `failed-stage`, `failed-run`, `blocked-run`, and `publication-failure` rows. Rules out silent no-op and a new feedback code.
- Reuse the target pipeline's current owning client and existing stage-mutation dispatch with the row's `pipelineId`, `stageId`, and `branchKey`. Rules out a new RPC path or daemon ownership rule.
- If an awaiting-gate row's pipeline has no current owner, report `stale_non_targetable` before eligibility dispatch and send no RPC. Rules out treating an owner-loss row as an approval refusal.

## Tasks

- Extend pipeline-steering selection and target resolution to accept an awaiting-gate attention row while retaining tree-stage behavior and owner-loss precedence.
- Pin awaiting dispatch, every non-awaiting-kind refusal, owner-loss refusal, owner routing, and RPC parameters in `v2/src/tui/tui-entry.test.tsx` with in-body mutation directives.
- Update the attention and dock-command contracts in `v2/docs/operator-runbook.md` and the TUI parity baseline in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `approve` on an awaiting-gate attention row issues one `pipeline_approve` through the target pipeline's owning daemon with the row's `pipelineId`, `stageId`, and `branchKey`.
- [x] `reject` on an awaiting-gate attention row issues one `pipeline_reject` through the same target resolution.
- [x] `approve` and `reject` on `rejected-gate`, `failed-stage`, `failed-run`, `blocked-run`, or `publication-failure` attention rows report `not_awaiting_stage` and issue no RPC.
- [x] `approve` and `reject` on an awaiting-gate attention row whose pipeline owner disappears report `stale_non_targetable` and issue no RPC.
- [x] Existing selected-tree-stage cases `typed approve issues pipeline_approve for the selected awaiting stage` and `typed reject issues pipeline_reject for the selected awaiting stage` in `v2/src/tui/tui-entry.test.tsx` stay green.
- [x] `v2/src/tui/tui-entry.test.tsx` — `attention commands act only on awaiting-gate pins`; Keystone checkpoint: reverting attention selection to the pre-fix tree-only resolution makes the scoped test fail.
- [x] `v2/src/tui/tui-entry.test.tsx` — `attention commands act only on awaiting-gate pins`; Mutation checkpoint: inverting each added or modified attention eligibility guard makes the scoped test fail, including the no-RPC negative cases.
- [x] `v2/docs/operator-runbook.md` documents gate action from an awaiting attention row and `not_awaiting_stage` refusal for other attention rows; `v2/docs/v1-behaviors.md` records the widened selection contract.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe and § Dock commands — attention-row gate dispatch and refusal.
- `v2/docs/v1-behaviors.md` § TUI / observability — widened `approve` and `reject` selection.
