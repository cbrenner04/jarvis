## Verdict: refinements required before merge

Direction matches intent: reuse `step-runner.ts` `failureKind`, quota-only fallback, durable attempt summary, foreground `jarvis write` surface. The draft is implementable but has load-bearing gaps that would let an implementer attach binding-chain detail to the wrong terminals or ship ambiguous operator contracts.

### Required refinements

1. **Step-level guard for failure detail** — The loop maps both binding-chain failure (`StepRunResult.kind === "invocation_failure"`) and post-invocation token parse failure (`invalid_token`) to `WriteLoopResult.kind === "invocation_failure"`. The spec must state that `failureKind` and binding-attempt detail attach only when the step result is binding-chain `invocation_failure` (equivalently: only when `failureKind` is present on the step result). Add acceptance criteria that `invalid_token` terminals omit both fields on stdout and on idempotent re-entry.

2. **Named operator JSON fields** — Acceptance criteria must pin exact top-level property names on `WriteLoopResult` / `jarvis write` stdout when `kind === "invocation_failure"` (e.g. `failureKind`, `bindingAttempts`), not substring presence. `cli.test.ts` should assert those keys.

3. **Negative attachment criteria** — Decision “detail only on `invocation_failure`” needs matching ACs: `complete`, `blocked`, `contract_miss`, `budget-exhausted`, and `invalid_token` outcomes must not include `failureKind` or binding-attempt detail.

4. **Pre-migration / absent persisted detail** — This slice extends durable schema. The spec must decide load behavior for `failed` runs committed before the extension: omit detail vs migrate-on-read. Idempotent re-entry AC must match that decision (detail-free resume for legacy rows, or equivalent explicit rule). Rules out synthesizing defaults that misreport chain cause.

5. **Persistence contract** — Task/decision must cover where invocation-failure detail lives in the store (column vs JSON blob), that it is absent for non-binding-chain terminal outcomes, and that `state-store.md` schema prose matches implementation. Forward-only migration per existing `state-store.md` policy.

6. **`write-behavior.md` corrections** — Doc updates must replace stale “all agents exhausted / not wired” prose with the `failureKind` taxonomy and fix the exit-code contradiction (line 40 says exit `1`; exit table and code use `2` for `invocation_failure`). Doc work is acceptance-gated, not checklist-only.

7. **`v2/docs/v1-behaviors.md` stance** — Per spec guidance, add explicit documentation bullet: no v1 change — additive v2 operator JSON on existing `invocation_failure` outcome (peer v2 specs record this).

8. **Log-stream preservation** — Slice defers log-stream extension but must not regress existing terminal payloads. Add preservation AC citing `write-loop.test.ts` structured-log-stream terminal tests stay green.

9. **`no_binding` operator semantics** — `write-behavior.md` must state `no_binding` is exercised via empty injected bindings / test seam today; live `createAgentBindings` currently yields `failureKind: "error"`, not `no_binding`.

10. **Foreground JSON wording** — Drop or correct “compact JSON” decision; `jarvis write` currently pretty-prints. Outcome: “foreground `jarvis write` JSON” without mandating compaction unless a normalization task is added.

### Not required (advocate defense accepted)

- Dedicated `loadRun`-only AC if idempotent re-entry tests use a real store path end-to-end.
- Export module placement decision (implementer choice within inline doc-comment task).
- Explicit mixed `quota → … → model_config` AC (covered by per-kind + “summary ends at terminal attempt”).
- Full `shared-step-runner.md` taxonomy section (cross-link from `shared-invocation.md` suffices).
- `## Prerequisites` echo in subspec.
- Daemon/log-stream payload extension (correctly deferred).

### Rationale summary

Highest risk is conflating `invalid_token` with binding-chain `invocation_failure` under one loop kind — would violate intent scope and leak wrong detail to operators. Second tier: wire shape ambiguity, schema/backfill silence, missing negative ACs, and doc drift (`write-behavior.md`, `v1-behaviors.md`) that spec guidance treats as blocking for behavior-touching slices.
