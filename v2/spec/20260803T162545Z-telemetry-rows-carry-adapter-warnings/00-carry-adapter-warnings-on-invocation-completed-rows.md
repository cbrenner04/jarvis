# Carry adapter warnings on invocation_completed rows

Adapters return `warnings` on `InvocationOk`, but `createInvocationCompletedRecord`
(`shared/invocation/execute.ts`) drops them, so `~/.jarvis/telemetry.jsonl` can show
`usage_source: "unavailable"` with no diagnosable reason.

## Decisions

- Add `warnings: string[]` to `InvocationCompletedRecord` and populate it in `createInvocationCompletedRecord` — rules out leaving regression diagnosis to adapter source reading.
- Place `warnings` after `cost_source` and before `exit_kind` / `exit_reason` in the returned record — rules out a final-property layout that breaks `@mutate` trailing-comma pinning.
- Map with `okResult?.warnings ?? []` so ok rows copy adapter strings and every non-ok row gets `[]` — rules out an ok-only optional field and rules out propagating warnings from non-ok exit kinds.
- Keep `schema_version: 1` — rules out a version bump that forces every reader to fork.
- Out of scope: new warning text, per-agent wording changes, run-summary/TUI rendering, and the codex usage path itself.

## Tasks

- Extend `InvocationCompletedRecord` and `createInvocationCompletedRecord` per decisions (`warnings` after `cost_source`, before `exit_kind`).
- Add `execute.test.ts` coverage: ok with warnings asserts `row.warnings` equals the adapter strings via `toEqual([...])`; ok without warnings and each non-ok `exit_kind` (`quota`, `stall`, `error`, `model_config`) asserts `row.warnings` via `toEqual([])`.
- Add a `// @mutate shared/invocation/execute.ts "warnings: okResult?.warnings ?? []," -> ""` directive on the warnings pinning test.
- Update `v2/docs/telemetry-capture.md` and `v2/docs/v1-behaviors.md` per Documentation updates.
- Run `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared`.

## Acceptance criteria

- [ ] `execute.test.ts` — an ok invocation whose adapter returned warnings emits an `invocation_completed` row whose `warnings` field is present and `toEqual`s those warning strings; fails against the current record builder, which has no `warnings` field.
- [ ] `execute.test.ts` — an ok invocation with no warnings and each non-ok `exit_kind` (`quota`, `stall`, `error`, `model_config`) emits a row whose `warnings` field is present and `toEqual([])`.
- [ ] `execute.test.ts` — applying the `// @mutate` directive that omits `warnings` from the emitted row turns the warnings regression RED.
- [ ] `execute.test.ts` — `appends one invocation_completed row per binding attempt in order` stays green.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — `invocation_completed` field list gains `warnings: string[]`, always present (`[]` when the adapter returned none or the exit kind is non-ok).
- `v2/docs/v1-behaviors.md` — update the shared Codex invocation bullet (~line 409): `invocation_completed` rows now carry adapter `warnings` (usage/cost unavailability wording may remain accurate until the codex usage path lands).
