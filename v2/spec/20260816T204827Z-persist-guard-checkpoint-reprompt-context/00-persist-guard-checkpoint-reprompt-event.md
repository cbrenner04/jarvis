# 00 - Persist guard-checkpoint reprompt event

## Problem

Guard-checkpoint repair context exists only in the live write loop, so a pause leaves no durable record from which later daemon work can recover the complete repair set.

## Behavior

Each admitted guard-checkpoint repair appends one `guard_checkpoint_reprompt` run-log event for the whole repair set. The event carries `attemptId` and one structured `repairs` array whose rows preserve the existing repair context: checkpoint kind, criterion text, resolved repo-relative pin path, `unlinked` or `hollow` reason, and linked-directive identity when present. It stores no rendered prompt prose.

The event participates in the run log's normal per-run sequence ordering. Existing `mutation_directive_reprompt` and `keystone_directive_reprompt` payloads and historical records remain readable unchanged.

## Decisions

- Persist one event with the complete ordered `repairs` array; rules out one event per finding and partial replay.
- Persist the existing structured repair rows, including optional linked-directive identity, without rendered prompt text; rules out resume compatibility depending on prompt wording or recomputing evidence from a changed worktree.
- Add `guard_checkpoint_reprompt` without changing either existing directive-reprompt event shape; rules out a migration or historical-log rewrite.
- Deferred to first consumer: daemon replay selection and context reconstruction — pin when a caller needs it.

## Task checklist

- [ ] Add the structured guard-checkpoint reprompt event to the durable `LogEvent` contract and share its repair-row shape with the producer without duplicating incompatible execution and persistence types.
- [ ] Append exactly one event when the write loop admits the complete guard repair set; preserve normal run-log sequencing and existing directive-reprompt events.
- [ ] Add focused producer and log-stream regressions.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [x] For a multi-finding eligible repair (`unlinked` and `hollow` guards plus an unlinked keystone), exactly one `guard_checkpoint_reprompt` event is appended carrying every repair row; test `guard checkpoint repair persists one complete structured event` in `v2/src/execution/write-loop.test.ts` fails against the pre-fix code because no event is emitted.
- [x] The persisted `guard_checkpoint_reprompt` event stores no rendered prompt prose, asserted by `guard checkpoint repair persists one complete structured event` in `v2/src/execution/write-loop.test.ts`.
- [x] The persisted event's `repairs` rows carry each finding's `attemptId`, checkpoint kind, criterion text, repo-relative pin path, `unlinked`/`hollow` reason, and optional hollow-directive identity; test `guard checkpoint reprompts round-trip in directive-event order` in `v2/src/persistence/log-stream.test.ts` pins those fields.
- [x] The `guard_checkpoint_reprompt` event holds its normal sequence position between unchanged `mutation_directive_reprompt` and `keystone_directive_reprompt` events, covered by `guard checkpoint reprompts round-trip in directive-event order` in `v2/src/persistence/log-stream.test.ts`.
- [x] Historical `mutation_directive_reprompt` and `keystone_directive_reprompt` records remain readable with their current payloads, covered by `guard checkpoint reprompts round-trip in directive-event order` in `v2/src/persistence/log-stream.test.ts`.
- [x] `v2/src/execution/write-loop.test.ts` — `guard checkpoint repair persists one complete structured event`; Keystone checkpoint: removing the guard-event append turns this pin red.
- [x] `v2/src/execution/write-loop.test.ts` — `guard checkpoint repair persists one complete structured event`; Mutation checkpoint: inverting the repair-admission guard turns this pin red and proves the event is emitted only from an admitted repair branch.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — canonical durable guard-reprompt event fields (`guard_checkpoint_reprompt`, its complete structured repair array, omission of rendered prose) and stream ordering.
- `v2/docs/v1-behaviors.md` — parity-catalog link to that contract and preserved existing-event compatibility.

## Blocker

`bun run test:v2` failed twice: `completion-commit.test.ts` and `diff-derived-mutation-verifier.test.ts` each timed out after 30 seconds in nested Bun subprocesses. Focused regressions, mutation checkpoints, `bun run typecheck`, and `bun run test:integration:v2` pass.
