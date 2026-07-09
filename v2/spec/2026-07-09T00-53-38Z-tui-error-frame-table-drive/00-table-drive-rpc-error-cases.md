# 00 - Table-drive TuiDaemonRpcError cases

`v2/src/tui/tui-daemon-client.test.ts` enumerates `TuiDaemonRpcError`
method/code pairs as 9 separate near-identical `test(...)` bodies (some
covering more than one pair each):

- `rejects correlated health error frames as TuiDaemonRpcError` — `health`/`unhealthy`
- `rejects correlated status error frames as TuiDaemonRpcError` — `status`/`status_unavailable`
- `list and wait correlated error frames reject as TuiDaemonRpcError` — `list`/`internal_error`, `wait`/`unknown_run`
- `start rejects run_in_progress as TuiDaemonRpcError` — `start`/`run_in_progress`
- `start rejects worktree_claimed as TuiDaemonRpcError` — `start`/`worktree_claimed`
- `start rejects generic daemon error frames as TuiDaemonRpcError` — `start`/`invalid_params`
- `steering correlated error frames reject as TuiDaemonRpcError` — `pause`/`unknown_run`, `resume`/`terminal_run`, `kill`/`unknown_run`
- `pause and kill reject run_not_active as TuiDaemonRpcError` — `pause`/`run_not_active`, `kill`/`run_not_active`
- `resume rejects run_in_progress as TuiDaemonRpcError` — `resume`/`run_in_progress`

13 method/code pairs total. Replace these 9 tests with one table-driven test
over the 13 pairs.

## Decisions

- One table, one `test.each`-style loop (or equivalent Bun-supported
  iteration) driving all 13 method/code pairs; each row supplies method,
  request id, error code, message, the client call, and the expected
  rejection shape.
- Preserve each row's original assertion strength: rows that asserted
  `toBeInstanceOf(TuiDaemonRpcError)` only keep that; rows that asserted
  `code`/`name`/`message` via `toMatchObject` keep that same shape.
- Rows sourced from a shared-connection/multiplexed-request test (`list`/
  `wait`, and the `pause`/`resume`/`kill` steering pairs) keep that source
  test's concurrent-request structure: multiple requests issued on one
  connection, asserting only the correlated request rejects. Only the
  per-pair assertion body is factored into the table — the connection/
  request structure is not flattened to one request per row.
- Tests outside this method/code enumeration (malformed replies, success
  payloads, non-error-frame behavior) are untouched.

## Out of scope

- Src changes (per intent).
- Any change to non-`TuiDaemonRpcError` tests in this file.

## Task checklist

- [ ] Build the method/code table (13 rows) from the pairs listed above,
      each carrying its own request id constant, error code, message, and
      expected assertion shape.
- [ ] Replace the 9 enumerated tests with one loop over the table, keeping
      the `list`/`wait` and `pause`/`resume`/`kill` rows inside their
      original multi-request, shared-connection setup (e.g. `withFixedUuid`)
      rather than flattening each to an isolated single-request test.
- [ ] Remove now-unused per-test scaffolding only if no longer referenced
      elsewhere in the file.

## Acceptance criteria

- [x] `bun test v2/src/tui/tui-daemon-client.test.ts` passes.
- [x] All 13 method/code pairs listed above still have a passing assertion
      that the call rejects as `TuiDaemonRpcError` (with `code`/`name`
      matched where the original test matched it).
- [x] The `list`/`wait` pair and the `pause`/`resume`/`kill` steering pairs
      still assert concurrent-request correlation: multiple requests
      in-flight on a shared connection, only the correlated one rejecting —
      not collapsed to isolated single-request assertions.
- [ ] PR body states the test-count diff vs baseline and names each removed
      test alongside the table row(s) now covering its cases.

## Documentation updates

None — test-only change, no behavior/architecture/operator-facing change.