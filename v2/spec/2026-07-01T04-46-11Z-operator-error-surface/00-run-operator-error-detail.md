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
  `runStatus`.
- Closed `nextAction` union (`resume` | `inspect_spec` | `fix_config` |
  `retry_later` | `stop` | `none`) — rules out free-text remediation hints.
- Compose from durable `loadRun` + optional last terminal log record only —
  rules out reading agent stderr, exit codes, or binding attempt transcripts.
- Terminal log precedence matches `wait`: prefer last `loop_finished`; else last
  `run_execution_failed`; else store-only — rules out divergent list vs wait
  composition.
- Omit `error` on in-progress runs and on success (`runStatus: "completed"` with
  no operator-actionable stop) — rules out nullable noise on healthy rows.
- `invocation_failure_detail.failureKind` maps into `reason` only when terminal
  attempt `outcome_kind` is binding-chain `invocation_failure` — rules out
  reusing `failureKind` on `invalid_token` or legacy detail-free rows.
- Harness spawn-boundary stops (`run_execution_failed` or `runStatus: "failed"`
  without `loop_finished`) map to `reason: "harness_failure"` — rules out
  collapsing them into invocation categories.
- `list` and `wait` share one composer and wire shape — rules out list-only or
  wait-only error payloads.
- Deferred to first consumer: exact CLI column layout and human labels — pin in
  `01-cli-run-error-surface`.

### Reason mapping

| Inputs | `reason` | `retryable` | `nextAction` |
| --- | --- | --- | --- |
| `loopOutcomeKind: "paused"` or `runStatus: "paused"` | `resumable_pause` | `true` | `resume` |
| `loopOutcomeKind: "budget-exhausted"` or `runStatus: "budget-soft-stopped"` | `resumable_budget` | `true` | `resume` |
| `runStatus: "killed"` (no `loop_finished`) | `resumable_kill` | `true` | `resume` |
| `loopOutcomeKind: "blocked"` | `agent_blocked` | `false` | `inspect_spec` |
| `loopOutcomeKind: "contract_miss"` | `contract_miss` | `false` | `inspect_spec` |
| binding-chain `invocation_failure` + `failureKind: "quota"` | `quota_exhausted` | `false` | `retry_later` |
| binding-chain `invocation_failure` + `failureKind: "model_config"` | `model_config` | `false` | `fix_config` |
| binding-chain `invocation_failure` + `failureKind: "no_binding"` | `no_binding` | `false` | `fix_config` |
| binding-chain `invocation_failure` + `failureKind: "error"` | `invocation_error` | `false` | `stop` |
| terminal `invalid_token` (no binding-chain detail) | `invalid_token` | `false` | `stop` |
| `run_execution_failed` or `runStatus: "failed"` without `loop_finished` | `harness_failure` | `false` | `stop` |

## Task checklist

- Export shared `RunOperatorError` types and `composeRunOperatorError` with
  inline doc-comments on exported symbols.
- Implement mapping per table; unit-test each row and omit cases.
- Extend daemon `list` rows with optional `error`; replay persisted logs per row
  via injected `logReader` when composing (no `follow` on list).
- Extend daemon `wait` success payload with the same optional `error` composed at
  resolve time.
- Extend `daemon-wire` parsers/validators for list and wait payloads.
- Co-located daemon tests: list and wait include `error` for representative
  stops; omit on in-progress and `complete`; list/wait agree on the same run.
- Update durable docs per Documentation updates.

## Acceptance criteria

- [ ] `composeRunOperatorError` returns `reason: "resumable_pause"`, `retryable: true`, `nextAction: "resume"` for a paused run whose last terminal signal is `loop_finished` with `loopOutcomeKind: "paused"` (unit test).
- [ ] `composeRunOperatorError` returns `reason: "resumable_budget"`, `retryable: true`, `nextAction: "resume"` for `budget-soft-stopped` / `budget-exhausted` terminal shapes (unit test).
- [ ] `composeRunOperatorError` returns `reason: "resumable_kill"`, `retryable: true`, `nextAction: "resume"` for durable `killed` without `loop_finished` (unit test).
- [ ] `composeRunOperatorError` returns `reason: "agent_blocked"` / `"contract_miss"` with `nextAction: "inspect_spec"` and `retryable: false` for the matching `loopOutcomeKind` values (unit test).
- [ ] `composeRunOperatorError` maps each binding-chain `failureKind` (`quota`, `model_config`, `no_binding`, `error`) to the matching `reason` and `nextAction` per the table (unit test, injected store rows).
- [ ] `composeRunOperatorError` returns `reason: "invalid_token"`, `retryable: false`, `nextAction: "stop"` when terminal attempt is `invalid_token` without `invocation_failure_detail` (unit test).
- [ ] `composeRunOperatorError` returns `reason: "harness_failure"`, `retryable: false`, `nextAction: "stop"` when the last terminal log is `run_execution_failed` or durable status is `failed` without `loop_finished` (unit test).
- [ ] `composeRunOperatorError` returns `undefined` for in-progress runs and for successful `completed` terminals (unit test).
- [ ] Daemon `list` includes `error` on failed/blocked/paused/killed/budget-soft-stopped rows and omits it on in-progress and successful `completed` rows (socket test).
- [ ] Daemon `wait` resolve payload includes the same `error` object as `list` for the same run at resolve time (socket test).
- [ ] `v2/src/daemon-start-list.test.ts` and `v2/src/daemon-wait-run-completion.test.ts` stay green except where extended for `error` fields.
- [ ] `v2/docs/daemon-host.md` documents optional `error` on `list` rows and `wait` results: field list, reason/action semantics table, omission rules, no stderr/transcripts.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `list` and `wait` optional `error` payload, reason/
  nextAction semantics, omission rules.
- Inline doc-comments on exported operator-error types and composer.
