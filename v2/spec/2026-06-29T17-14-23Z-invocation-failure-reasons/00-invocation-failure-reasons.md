# 00 — Invocation failure reasons

When a binding chain ends without usable agent output, propagate the existing
`step-runner.ts` `failureKind` through the write loop into durable state and
foreground `jarvis write` JSON. Include an ordered `bindingAttempts` summary; no
new taxonomy, no stderr in the durable contract. Exercised via injected test
bindings (`v2/src/testing/bindings.ts`).

## Decisions

- Reuse the closed `failureKind` union from `StepRunResult` (`quota` |
  `model_config` | `error` | `no_binding`) — rules out a parallel reason enum in
  the loop, store, or CLI.
- Quota-only fallback semantics stay unchanged — rules out advancing the binding
  chain on `model_config` or `error`.
- `bindingAttempts` is ordered `{ bindingId, resultKind }[]` where `resultKind` is
  each attempt's `InvocationResult.kind` — rules out persisting stderr, exit
  codes, or stdout as the resume contract.
- `failureKind` alone encodes chain stop cause (`quota` = fallback exhausted,
  `model_config`/`error` = terminal non-quota stop, `no_binding` = no bindings
  configured) — rules out a redundant `fallbackExhausted` boolean.
- `failureKind` and `bindingAttempts` attach only when
  `StepRunResult.kind === "invocation_failure"` — rules out binding-chain detail
  on `invalid_token` even though both map to loop `kind: "invocation_failure"`.
- Operator fields attach only on loop `kind: "invocation_failure"` results that
  carry binding-chain detail — rules out nullable failure fields on every
  `WriteLoopResult`.
- Persist detail as nullable JSON on the terminal `attempts` row
  (`invocation_failure_detail`: `{ failureKind, bindingAttempts }`); forward-only
  migration per `state-store.md` — rules out migrate-on-read synthesis.
- Column absent/null for non-binding-chain terminal outcomes (`invalid_token`,
  `complete`, `blocked`, etc.) — rules out storing detail on wrong terminals.
- Legacy `invocation_failure` rows without persisted detail omit `failureKind` and
  `bindingAttempts` on load/re-entry — rules out inventing defaults that
  misreport chain cause.
- Foreground `jarvis write` JSON is the operator surface for this slice — rules
  out extending log-stream event shapes here (daemon/TUI deferred).
- Idempotent re-entry returns persisted `failureKind` and `bindingAttempts` only
  when the terminal attempt row has `invocation_failure_detail` — rules out
  detail-free resume for post-migration binding-chain failures.
- Deferred to first consumer: log-stream / daemon payload for invocation-failure
  detail — pin when run-control tail needs it.

## Task checklist

- [x] Export a shared invocation-failure detail type (`failureKind` + ordered
  `bindingAttempts`) with inline doc-comments on exported symbols.
- [x] Append forward-only migration: nullable `invocation_failure_detail` JSON on
  `attempts`; extend `commitCompletionBoundary` to persist it only for binding-
  chain `invocation_failure`; reload via `loadRun` / `findRunByProjectBranch`.
- [x] Thread `failureKind` and `bindingAttempts` from `runStep` through
  `executeWrite` / `executeWriteLoop` into boundary commit and `WriteLoopResult`
  only when `StepRunResult.kind === "invocation_failure"`.
- [x] Include `failureKind` and `bindingAttempts` in foreground `jarvis write`
  JSON only for binding-chain `invocation_failure`.
- [x] Co-located tests for each `failureKind` path, negative attachment,
  `invalid_token`, legacy detail-free resume, and idempotent re-entry with detail.
- [x] Update durable docs per documentation updates; gate on acceptance criteria
  below.

## Acceptance criteria

- [x] A binding chain where every configured agent returns `quota` ends with
  `failureKind: "quota"` and `bindingAttempts` listing each binding in order with
  `resultKind: "quota"` (test, injected bindings).
- [x] A chain stopped by `model_config` or `error` on the first non-quota result
  reports that `failureKind` and `bindingAttempts` ending at the terminal attempt
  (test, per kind).
- [x] An empty binding list reports `failureKind: "no_binding"` with
  `bindingAttempts: []` (test).
- [x] `jarvis write` stdout JSON on binding-chain `invocation_failure` includes
  top-level keys `failureKind` and `bindingAttempts` with the persisted values
  (test, `cli.test.ts`).
- [x] `invalid_token` terminal: `jarvis write` stdout JSON has `kind:
  "invocation_failure"` but omits `failureKind` and `bindingAttempts`; idempotent
  re-entry omits them too (test).
- [x] Terminal outcomes `complete`, `blocked`, `contract_miss`, and
  `budget-exhausted` omit `failureKind` and `bindingAttempts` on stdout JSON
  (test).
- [x] Re-invoking a run whose terminal attempt has persisted
  `invocation_failure_detail` returns the same `failureKind` and `bindingAttempts`
  without a new attempt (test).
- [x] Re-invoking a pre-migration `failed` run whose terminal attempt has
  `outcome_kind: "invocation_failure"` and null `invocation_failure_detail`
  returns `kind: "invocation_failure"` without `failureKind` or `bindingAttempts`
  (test).
- [x] `v2/src/write.test.ts` quota-fallback success test stays green (quota-only
  advance unchanged).
- [x] `v2/src/write-loop.test.ts` structured-log-stream terminal tests stay green
  (log-stream payloads unchanged by this slice).
- [x] `v2/docs/shared-invocation.md` documents terminal `failureKind` categories
  and quota-only fallback stop.
- [x] `v2/docs/write-behavior.md` documents `failureKind` / `bindingAttempts` on
  binding-chain `invocation_failure`, states `no_binding` is exercised via empty
  injected bindings today (live `createAgentBindings` yields `error`), and exit
  `2` for `invocation_failure` (replaces stale exhausted/not-wired prose).
- [x] `v2/docs/state-store.md` documents nullable `invocation_failure_detail` on
  terminal binding-chain attempts, forward-only migration, and legacy rows omit
  detail on load.
- [x] `v2/docs/v1-behaviors.md`: no v1 change — additive v2 operator JSON on
  existing `invocation_failure` outcome.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — terminal `failureKind` categories and how they
  relate to quota-only fallback stop.
- `v2/docs/write-behavior.md` — operator-visible `invocation_failure` JSON
  fields (`failureKind`, `bindingAttempts`); `no_binding` test-seam semantics;
  exit-code alignment.
- `v2/docs/state-store.md` — `invocation_failure_detail` on committed binding-
  chain `invocation_failure` attempts; legacy load behavior.
- `v2/docs/v1-behaviors.md` — no v1 change stance.
- Inline doc-comments on exported invocation-failure types.
