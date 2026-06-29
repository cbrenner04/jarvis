# 00 — Invocation failure reasons

When a binding chain ends without usable agent output, propagate the existing
`step-runner.ts` `failureKind` through the write loop into durable state and
foreground `jarvis write` JSON. Include an ordered binding-attempt summary; no new
taxonomy, no stderr in the durable contract. Exercised via injected test
bindings (`v2/src/testing/bindings.ts`).

## Decisions

- Reuse the closed `failureKind` union from `StepRunResult` (`quota` |
  `model_config` | `error` | `no_binding`) — rules out a parallel reason enum in
  the loop, store, or CLI.
- Quota-only fallback semantics stay unchanged — rules out advancing the binding
  chain on `model_config` or `error`.
- Durable binding-attempt summary is ordered `{ bindingId, resultKind }[]` where
  `resultKind` is each attempt's `InvocationResult.kind` — rules out persisting
  stderr, exit codes, or stdout as the resume contract.
- `failureKind` alone encodes chain stop cause (`quota` = fallback exhausted,
  `model_config`/`error` = terminal non-quota stop, `no_binding` = no bindings
  configured) — rules out a redundant `fallbackExhausted` boolean.
- Invocation-failure detail attaches only to `invocation_failure` outcomes —
  rules out nullable failure fields on every `WriteLoopResult`.
- Foreground `jarvis write` compact JSON is the operator surface for this slice —
  rules out extending log-stream event shapes here (daemon/TUI deferred).
- Idempotent re-entry on a `failed` run returns the persisted
  invocation-failure detail — rules out detail-free `invocation_failure` on
  resume.
- Deferred to first consumer: log-stream / daemon payload for invocation-failure
  detail — pin when run-control tail needs it.

## Task checklist

- [ ] Export a shared invocation-failure detail type (failure kind + ordered
  binding attempts) with inline doc-comments on exported symbols.
- [ ] Extend the state store schema and `commitCompletionBoundary` to persist
  invocation-failure detail on terminal `invocation_failure` attempts; reload on
  `loadRun` / `findRunByProjectBranch`.
- [ ] Thread `failureKind` and binding attempts from `runStep` through
  `executeWrite` / `executeWriteLoop` into boundary commit and `WriteLoopResult`.
- [ ] Include invocation-failure detail in foreground `jarvis write` JSON when
  `kind === "invocation_failure"`.
- [ ] Co-located tests for each `failureKind` path and idempotent re-entry.

## Acceptance criteria

- [ ] A binding chain where every configured agent returns `quota` ends with
  `failureKind: "quota"` and an attempt summary listing each binding in order
  with `resultKind: "quota"` (test, injected bindings).
- [ ] A chain stopped by `model_config` or `error` on the first non-quota result
  reports that `failureKind` and a summary ending at the terminal attempt (test,
  per kind).
- [ ] An empty binding list reports `failureKind: "no_binding"` with an empty
  attempt summary (test).
- [ ] `jarvis write` stdout JSON includes `failureKind` and the binding-attempt
  summary on `invocation_failure` (test, `cli.test.ts`).
- [ ] Re-invoking a run whose terminal boundary is already `invocation_failure`
  returns the same persisted `failureKind` and attempt summary without a new
  attempt (test).
- [ ] `v2/src/write.test.ts` quota-fallback success test stays green (quota-only
  advance unchanged).
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — terminal `failureKind` categories and how they
  relate to quota-only fallback stop.
- `v2/docs/write-behavior.md` — operator-visible `invocation_failure` JSON
  fields (`failureKind`, binding-attempt summary).
- `v2/docs/state-store.md` — durable invocation-failure detail on committed
  `invocation_failure` attempts.
- Inline doc-comments on exported invocation-failure types.
