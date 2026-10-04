# Confinement policy and mechanism on invocation_completed rows

`InvocationCompletedRecord` carries `agent` and `model` but not which `confinementPolicy` was in effect or which adapter mechanism applied, so `~/.jarvis/telemetry.jsonl` cannot answer whether a run was sandboxed.

## Decisions

- Telemetry field names are `confinement_policy` and `confinement_mechanism` (snake_case on the row) — rules out `confinement_vendor_mechanism` and camelCase wire keys.
- `confinement_policy` values are exactly `ConfinementPolicy` literals from `shared/invocation/confinement-policy.ts` (`sandbox`, `unrestricted`) — rules out config-path keys or adapter-specific policy names on the row.
- `confinement_mechanism` values are exactly `ConfinementMechanism` literals from the same module (`codex-workspace-write`, `codex-read-only`, `none`) — rules out invented per-vendor aliases such as `claude-permission-mode` or `cursor-force` on the wire; `refused` stays binding-only because refused rungs never emit `invocation_completed` rows (`execute.ts` ~341–347).
- Place both fields after `model` and before `binding_id` on `InvocationCompletedRecord` — rules out grouping them after settlement fields away from agent attribution.
- Stamp `confinementPolicy` on every binding `createResolvedAgentBinding` / `bindConfined` / `createRefusingBinding` produces alongside existing `confinementMechanism` — rules out v2-only parallel policy context that write-loop and step-runner could drift from.
- `InvocationBinding.confinementPolicy` is required on bindings whose `confinementMechanism` is not `refused`, and `createInvocationCompletedRecord` must not apply `??` defaults when binding confinement fields are absent — rules out fail-open rows that typecheck while misreporting confinement.
- `createInvocationCompletedRecord` copies `confinement_policy` and `confinement_mechanism` from the binding passed into `appendInvocationTelemetry`; both are required non-null on every appended row — rules out optional telemetry columns and rules out inferring policy from mechanism after the fact.
- Keep `schema_version: 1` — rules out a version bump that forks every telemetry reader.
- Out of scope: changing refusal / no-row semantics, config cascade, adapter argv translation, and run-summary/TUI rendering of confinement.

## Tasks

- Extend `InvocationBinding` with `confinementPolicy` where production bindings are built; stamp it in `shared/invocation/agents.ts` for translated and refused bindings.
- Extend `InvocationCompletedRecord` and `createInvocationCompletedRecord` per decisions; thread binding confinement through `appendInvocationTelemetry`.
- Update injected-binding helpers and stubs that construct full `InvocationCompletedRecord` objects (e.g. `telemetry-sink.test.ts` `stubInvocationRow`) so typecheck stays green.
- Add `agents.test.ts` coverage per acceptance criteria; add `execute.test.ts` coverage per acceptance criteria; extend the shared `binding()` test helper with explicit confinement defaults only where existing telemetry tests would otherwise omit required fields.
- Update `v2/docs/telemetry-capture.md`, `v2/docs/v1-behaviors.md`, and `v2/docs/operator-runbook.md` per Documentation updates.
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:shared`.

## Acceptance criteria

- [x] `shared/invocation/agents.test.ts` asserts `createResolvedAgentBinding` / `bindConfined` stamp matching `confinementPolicy` and `confinementMechanism` for at least two vendor/policy pairs (e.g. codex `sandbox` + `codex-workspace-write`, claude `unrestricted` + `none`); fails against pre-fix factories that omit `confinementPolicy`.
- [x] `shared/invocation/execute.test.ts` drives `executeWithQuotaFallback` with injected bindings that set `confinementPolicy` and `confinementMechanism` for at least two distinct agent/mechanism pairs (e.g. codex `sandbox` + `codex-workspace-write`, claude `unrestricted` + `none`) and asserts each `invocation_completed` row carries matching `confinement_policy` and `confinement_mechanism`; fails against the pre-fix record builder with no such fields.
- [x] `shared/invocation/execute.test.ts` — `a binding refused at construction skips prompt logging and telemetry but still advances` stays green (refused rungs still emit no row).
- [x] `v2/docs/telemetry-capture.md` `invocation_completed` field list documents `confinement_policy` and `confinement_mechanism` as required on every row.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — `invocation_completed` field list gains `confinement_policy` and `confinement_mechanism`, both required on every row (values from the resolved binding at invocation time).
- `v2/docs/v1-behaviors.md` — update the shared confinement / `invocation_completed` bullets so the behavior catalog records that every `invocation_completed` row carries resolved `confinement_policy` and `confinement_mechanism`.
- `v2/docs/operator-runbook.md` § Reading telemetry — add `confinement_policy` and `confinement_mechanism` to the field list and a short example query (filter by `run_id`) showing how to verify sandbox vs unrestricted from row values.
