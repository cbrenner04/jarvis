# Operator runbook

## Problem

Operators lack durable documentation for dock grammar, submission outcomes, detached start semantics, explicit expansion, and CLI fallbacks for unavailable verbs.

## Prerequisites

- `01-command-dispatch` and `02-status-row-projection` define the shipped command and status-row behavior.

## Work

- Update `v2/docs/operator-runbook.md` § Observe with dock grammar, retained success/failure outcomes, detached start semantics, explicit `expand`/`collapse`, expansion-selection feedback codes, status-row RPC/result suffix ordering, and CLI fallbacks for unavailable verbs.

## Acceptance criteria

- [ ] `v2/docs/operator-runbook.md` § Observe documents dock grammar, retained success/failure outcomes, detached start semantics, explicit expansion/collapse, expansion-selection feedback codes (`no_selection`, `run_leaf`, `unattributed`, `stale_non_expandable`), status-row `error`/`result` suffix ordering, and CLI fallbacks for unavailable verbs.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — grammar, outcomes, detached start, expansion, feedback codes, status-row ordering, and CLI fallbacks.
