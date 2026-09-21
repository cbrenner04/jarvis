# Wire TUI detail to the shared failure formatter

## Problem

TUI run detail omits run failure evidence, and stage detail renders `failureDetail` as stable JSON.

## Behavior

TUI run detail renders the formatter block from `run.failure`; stage detail renders it for a valid record and keeps the existing stable-JSON row for opaque legacy detail.

## Decisions

- Stage detail recognizes a valid record with `operatorFailureRecordFromUnknown`; malformed record-shaped and legacy detail keep the current stable-JSON row; rules out treating every failure-shaped object as canonical or dropping legacy diagnostics.
- Formatter lines are emitted as consecutive detail rows, unmodified apart from the host row prefix; rules out TUI-side relabeling or re-wrapping.

## Task checklist

- [ ] Render the formatter block for selected run detail from `run.failure`.
- [ ] Render the formatter block for selected stage detail with valid records; preserve the opaque fallback.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-lines.test.ts` proves selected run and stage records render the shared block and an opaque legacy or malformed stage failure retains its existing stable-JSON row; it fails against the pre-fix missing run record and raw record JSON.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` lifecycle detail tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/tui.md` — document shared run/stage failure detail and the opaque-detail fallback; link the operator-runbook “Reading a contract failure” field guide.
