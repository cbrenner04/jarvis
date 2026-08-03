# Status row projection

## Problem

Command submission feedback and refresh-owned RPC feedback share one fixed status row, but the projection contract does not define how both appear together.

## Prerequisites

- `01-command-dispatch` retains command success/error feedback independently from refresh-owned `lastRpcError`.

## Decisions

- The status row keeps the existing leading segments (`<active-count> active · <profile>@<digest> · refresh <interval>`) and appends retained feedback suffixes in fixed order: when `lastRpcError` is present, append a middle-dot separator then `error: <lastRpcError>`; when `lastCommandResult` is present, append a middle-dot separator then `result: <lastCommandResult>` after any RPC suffix — rules out hiding either feedback or reversing their order.
- Refresh merges preserve both retained fields; a successful refresh clears only `lastRpcError` and must not clear a retained command result — rules out refresh erasing submission feedback.
- `fitDockRow` truncates the composed status line from the right at narrow widths while preserving the leading active/profile/refresh prefix — rules out dropping the liveness header before feedback tails.

## Work

- Project retained command and RPC feedback together on the fixed status row in `v2/src/tui/tui-monitor-lines.ts`.
- Add pinning coverage in `v2/src/tui/tui-monitor-lines.test.ts`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-lines.test.ts` adds a regression that fails against the baseline and proves command success/error feedback survives refresh state, remains visible on the fixed status row alongside retained daemon RPC feedback, and `monitorDockLines` still returns exactly four rows.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` proves when both `lastRpcError` and `lastCommandResult` are retained the status row shows middle-dot `error: …` before middle-dot `result: …`, a successful refresh clears only the RPC suffix, and narrow-width projection still exposes both suffixes when they fit after the fixed prefix.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` carries a valid `// @mutate` directive for every added or modified status-row coexistence guard; inverting each real source condition turns its pin red, and production has no inversion hook.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — visible status-row grammar lands in `03-operator-runbook`.
