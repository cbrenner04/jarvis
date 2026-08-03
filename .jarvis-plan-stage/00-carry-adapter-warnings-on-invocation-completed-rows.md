# Carry adapter warnings on invocation_completed rows

Adapters return `warnings` on `InvocationOk`, but `createInvocationCompletedRecord`
(`shared/invocation/execute.ts`) drops them, so `~/.jarvis/telemetry.jsonl` can show
`usage_source: "unavailable"` with no diagnosable reason.

## Decisions

- Add `warnings: string[]` to `InvocationCompletedRecord` and populate it in `createInvocationCompletedRecord` — rules out leaving regression diagnosis to adapter source reading.
- Map with `okResult?.warnings ?? []` so ok rows copy adapter strings and every non-ok row gets `[]` — rules out an ok-only optional field and rules out propagating warnings from non-ok exit kinds.
- Keep `schema_version: 1` — rules out a version bump that forces every reader to fork.
- Out of scope: new warning text, per-agent wording changes, run-summary/TUI rendering, and the codex usage path itself.

## Tasks

- Extend `InvocationCompletedRecord` and `createInvocationCompletedRecord` per decisions.
- Add `execute.test.ts` coverage: ok with warnings copies strings onto the row; ok without warnings, `quota`, `stall`, and `error` each emit `warnings: []`.
- Add a `// @mutate shared/invocation/execute.ts "warnings: okResult?.warnings ?? []," -> ""` directive on the warnings pinning test.
- Update `v2/docs/telemetry-capture.md` per Documentation updates.
- Run `bun run typecheck` and `bun run test:shared`.

## Acceptance criteria

- [ ] `execute.test.ts` — an ok invocation whose adapter returned warnings emits an `invocation_completed` row carrying those warning strings; fails against the current record builder, which has no `warnings` field.
- [ ] `execute.test.ts` — an ok invocation with no warnings and a `quota`, `stall`, and `error` invocation each emit an empty `warnings` array.
- [ ] `execute.test.ts` — applying the `// @mutate` directive that omits `warnings` from the emitted row turns the warnings regression RED.
- [ ] `execute.test.ts` — `appends one invocation_completed row per binding attempt in order` stays green.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/telemetry-capture.md` — `invocation_completed` field list gains `warnings: string[]`, always present (`[]` when the adapter returned none or the exit kind is non-ok).
