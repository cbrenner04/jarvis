# 00 — Run operator error detail

Compose a stable operator error record from durable run state and the last
terminal log signal (`loop_finished` or `run_execution_failed`). Attach it to
daemon `list` rows and `wait` results when the run is not a clean in-progress or
success terminal. No classification changes at source; no stderr/transcripts in
the contract.

## Decisions

- Operator error is one object `{ reason, retryable, nextAction }` — rules out
  prose-only messages and rules out clients re-parsing `status` strings.
- Closed `reason` union covers intent categories: resumable stops, human blocks,
  config/setup, quota, harness — rules out exposing raw `failureKind` or
  `loopOutcomeKind` as the primary reason field.
- `retryable` is explicit on the wire — rules out inferring it from `reason` or
  `runStatus`; distinct from `wait.resumable` (loop-log legacy, may be absent on
  store-only quiescent resolves such as `killed` without loop fields).
- Closed `nextAction` union (`resume` | `inspect_spec` | `fix_config` |
  `retry_later` | `stop`) — rules out free-text remediation hints and `none`
  without a producer row.
- Compose from durable `loadRun` + optional last terminal log record only —
  rules out reading agent stderr, exit codes, or binding attempt transcripts.
- Terminal log precedence matches `wait`: prefer last `loop_finished`; else last
  `run_execution_failed`; else store-only from last committed attempt — rules out
  divergent list vs wait composition.
- Tie-break when log and durable status disagree: durable `runStatus` wins for
  resumable terminals (`killed`, `paused`, `budget-soft-stopped`); for `failed`
  / `blocked`, last-attempt store detail wins — rules out `loopOutcomeKind`
  alone on conflicting signals (e.g. `runStatus: "failed"` +
  `loopOutcomeKind: "complete"`).
- `invocation_failure` disambiguation: branch on last-attempt `outcome_kind`
  first (`invalid_token` vs binding-chain `invocation_failure`), then
  `invocation_failure_detail.failureKind` — rules out mapping from
  `loopOutcomeKind` alone.
- Omit `error` on in-progress runs and on success (`runStatus: "completed"` with
  no operator-actionable stop) — rules out nullable noise on healthy rows.
- Legacy detail-free binding-chain `invocation_failure` maps to
  `invocation_error` / `stop` — rules out `harness_failure` or unmapped.
- `harness_failure` only on spawn-boundary `run_execution_failed`, or durable
  `failed` without mappable last-attempt invocation detail and without a
  resumable status override — rules out store-only invocation failures.
- Kill: durable `runStatus: "killed"` → `resumable_kill` even when last
  `loop_finished` has `loopOutcomeKind: "progress"` (abort path) — rules out
  log-only or no-log-only kill mapping.
- `list` production always injects `logReader`; when absent (tests), compose
  store-only only — rules out failing `list` or omitting all `error`.
- Invalid `error` fields reject the entire `list` / `wait` payload — rules out
  partial acceptance per existing `daemon-wire` strictness.
- `list` and `wait` share one composer and wire shape — rules out list-only or
  wait-only error payloads.
- Deferred to first consumer: exact CLI column layout and human labels — pin in
  `01-cli-run-error-surface`.

### Reason mapping

Precedence: last `loop_finished` or `run_execution_failed` when present; else
last committed attempt from `loadRun`. Apply tie-break above when signals
conflict.

**Resumable (durable `runStatus` wins over conflicting log)**

| Inputs | `reason` | `retryable` | `nextAction` |
| --- | --- | --- | --- |
| `runStatus: "paused"` | `resumable_pause` | `true` | `resume` |
| `loopOutcomeKind: "paused"` (log, no conflicting status) | `resumable_pause` | `true` | `resume` |
| `runStatus: "budget-soft-stopped"` | `resumable_budget` | `true` | `resume` |
| `loopOutcomeKind: "budget-exhausted"` (log, no conflicting status) | `resumable_budget` | `true` | `resume` |
| `runStatus: "killed"` (with or without `loop_finished` / `loopOutcomeKind: "progress"`) | `resumable_kill` | `true` | `resume` |

**Human blocks**

| Inputs | `reason` | `retryable` | `nextAction` |
| --- | --- | --- | --- |
| `loopOutcomeKind: "blocked"` or `runStatus: "blocked"` + last attempt `outcome_kind: "blocked"` | `agent_blocked` | `false` | `inspect_spec` |
| `loopOutcomeKind: "contract_miss"` or last attempt `outcome_kind: "contract_miss"` | `contract_miss` | `false` | `inspect_spec` |

**Invocation (attempt `outcome_kind` first, then `failureKind`)**

| Inputs | `reason` | `retryable` | `nextAction` |
| --- | --- | --- | --- |
| last attempt `outcome_kind: "invalid_token"` | `invalid_token` | `false` | `stop` |
| binding-chain `invocation_failure` + `failureKind: "quota"` | `quota_exhausted` | `false` | `retry_later` |
| binding-chain `invocation_failure` + `failureKind: "model_config"` | `model_config` | `false` | `fix_config` |
| binding-chain `invocation_failure` + `failureKind: "no_binding"` | `no_binding` | `false` | `fix_config` |
| binding-chain `invocation_failure` + `failureKind: "error"` | `invocation_error` | `false` | `stop` |
| binding-chain `invocation_failure`, null `invocation_failure_detail` (legacy) | `invocation_error` | `false` | `stop` |

Log-keyed invocation rows use the same `outcome_kind` / `failureKind` branches
when the terminal signal implies `invocation_failure` and tie-break selects the
attempt detail.

**Harness**

| Inputs | `reason` | `retryable` | `nextAction` |
| --- | --- | --- | --- |
| last terminal log `run_execution_failed` | `harness_failure` | `false` | `stop` |
| `runStatus: "failed"`, no mappable last-attempt invocation detail, no resumable status override | `harness_failure` | `false` | `stop` |

## Task checklist

- Export shared `RunOperatorError` types and `composeRunOperatorError` with
  inline doc-comments on exported symbols.
- Implement mapping per table and tie-break rules; unit-test each row, store-only
  paths, omit cases, and conflict shapes.
- Extend daemon `list` rows with optional `error`; replay persisted logs per row
  via injected `logReader` when composing (no `follow` on list); store-only
  when `logReader` absent.
- Extend daemon `wait` success payload with the same optional `error` composed at
  resolve time.
- Extend `daemon-wire` parsers/validators for list and wait payloads; reject
  malformed `error` on the whole response.
- Co-located daemon tests: list and wait include `error` for representative
  stops; omit on in-progress and `complete`; list/wait agree on the same run;
  list without `logReader` composes store-only.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [ ] `composeRunOperatorError` returns `reason: "resumable_pause"`, `retryable: true`, `nextAction: "resume"` for `loop_finished` with `loopOutcomeKind: "paused"` (unit test).
- [ ] `composeRunOperatorError` returns `reason: "resumable_pause"` for store-only `runStatus: "paused"` with no terminal log (unit test).
- [ ] `composeRunOperatorError` returns `reason: "resumable_budget"`, `retryable: true`, `nextAction: "resume"` for log `budget-exhausted` and store-only `budget-soft-stopped` shapes (unit test).
- [ ] `composeRunOperatorError` returns `reason: "resumable_kill"`, `retryable: true`, `nextAction: "resume"` for durable `killed` without `loop_finished` (unit test).
- [ ] `composeRunOperatorError` returns `reason: "resumable_kill"` when `runStatus: "killed"` and last `loop_finished` has `loopOutcomeKind: "progress"` (unit test).
- [ ] `composeRunOperatorError` returns `reason: "agent_blocked"` / `"contract_miss"` with `nextAction: "inspect_spec"` and `retryable: false` for matching log `loopOutcomeKind` values (unit test).
- [ ] `composeRunOperatorError` returns `agent_blocked` / `contract_miss` from store-only `blocked` status and last-attempt `outcome_kind` when no terminal log (unit test).
- [ ] `composeRunOperatorError` maps each binding-chain `failureKind` (`quota`, `model_config`, `no_binding`, `error`) from log and store-only `failed` + attempt detail paths (unit test).
- [ ] `composeRunOperatorError` returns `reason: "invalid_token"`, `retryable: false`, `nextAction: "stop"` from log and store-only last-attempt `invalid_token` (unit test).
- [ ] `composeRunOperatorError` returns `reason: "invocation_error"`, `nextAction: "stop"` for legacy detail-free binding-chain `invocation_failure` (unit test).
- [ ] `composeRunOperatorError` returns `reason: "harness_failure"`, `retryable: false`, `nextAction: "stop"` for `run_execution_failed` and for `failed` without mappable attempt detail (unit test).
- [ ] `composeRunOperatorError` returns an invocation `reason` (not `harness_failure`) for `failed` + store invocation detail with no terminal log (unit test).
- [ ] `composeRunOperatorError` resolves `runStatus: "failed"` + `loopOutcomeKind: "complete"` to the store attempt detail per tie-break (unit test; shape pinned by `v2/src/cli.test.ts` wait exit-code matrix).
- [ ] `composeRunOperatorError` returns `undefined` for in-progress runs and for successful `completed` terminals (unit test).
- [ ] Daemon `list` includes `error` on failed/blocked/paused/killed/budget-soft-stopped rows and omits it on in-progress and successful `completed` rows (socket test).
- [ ] Daemon `list` without `logReader` still composes store-only `error` and does not fail the RPC (socket test).
- [ ] Daemon `wait` resolve payload includes the same `error` object as `list` for the same run at resolve time (socket test).
- [ ] `daemon-wire` rejects entire `list` / `wait` payloads when `error` has invalid `reason`, `nextAction`, or `retryable` (parser test).
- [ ] `v2/src/daemon-start-list.test.ts` and `v2/src/daemon-wait-run-completion.test.ts` stay green except where extended for `error` fields.
- [ ] `v2/docs/daemon-host.md` documents optional `error` on `list` rows and `wait` results: field list, reason/action semantics table, omission rules, no stderr/transcripts, `error.retryable` vs `wait.resumable` split, and `list` store-only composition when `logReader` is absent in tests.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `list` and `wait` optional `error` payload, reason/
  nextAction semantics, omission rules, `retryable` vs `resumable`, absent
  `logReader` behavior.
- Inline doc-comments on exported operator-error types and composer.
