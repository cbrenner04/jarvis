---
name: tui-error-frame-table-drive
---

# Table-drive tui error-frame TuiDaemonRpcError cases

The tui error-frame tests enumerate `TuiDaemonRpcError` cases per method/code
pair as separate near-identical tests.

## Decisions

- Table-drive the `TuiDaemonRpcError` cases as one method × code table.

## Out of scope

- Src changes.
- Dropping coverage for any method/code pair.

## Verification

Test-count diff vs baseline in the PR body; every dropped test named with its
surviving owner.

## Prerequisites
