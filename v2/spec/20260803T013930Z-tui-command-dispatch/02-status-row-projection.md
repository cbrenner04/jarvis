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
- Document the shipped dock and status-row grammar in `v2/docs/operator-runbook.md` § Observe.
- Record shipped TUI admission and explicit expansion in `v2/docs/v1-behaviors.md`; correct stale command-dock language in `v2/spec/tui-overhaul-brief.md`.

## Acceptance criteria

- [ ] `v2/src/tui/tui-monitor-lines.test.ts` adds a regression that fails against the baseline and proves command success/error feedback survives refresh state, remains visible on the fixed status row alongside retained daemon RPC feedback, and `monitorDockLines` still returns exactly four rows.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` proves when both `lastRpcError` and `lastCommandResult` are retained the status row shows middle-dot `error: …` before middle-dot `result: …`, a successful refresh clears only the RPC suffix, and narrow-width projection still exposes both suffixes when they fit after the fixed prefix.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` carries a valid `// @mutate` directive for every added or modified status-row coexistence guard; inverting each real source condition turns its pin red, and production has no inversion hook.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/operator-runbook.md` § Observe documents dock grammar, retained success/failure outcomes, detached start semantics, explicit expansion/collapse, expansion-selection feedback codes (`no_selection`, `run_leaf`, `unattributed`, `stale_non_expandable`), status-row `error`/`result` suffix ordering, and CLI fallbacks for unavailable verbs.
- [ ] `v2/docs/v1-behaviors.md` records TUI pipeline admission and local explicit `expand`/`collapse` commands.
- [ ] `v2/spec/tui-overhaul-brief.md` replaces the `expand`/`collapse` toggle row with explicit expansion/collapse semantics for the selected pipeline or stage node, and replaces the "parser and admission API have no caller" dispatch gap with command-dock dispatch shipped status while steering commands remain open.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — grammar, outcomes, detached start, expansion, feedback codes, status-row ordering, and CLI fallbacks.
- `v2/docs/v1-behaviors.md` — TUI admission and explicit expansion commands.
- `v2/spec/tui-overhaul-brief.md` — explicit expand/collapse semantics and command-dock dispatch shipped; steering open.
