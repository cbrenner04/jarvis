# Retire checkpoint reprompt log events

## Prerequisites

- `retire-implement-mutation-checkpoint-verification` is merged to `main` before any implementation run against this spec; on the plan base implement still emits checkpoint reprompt log events and retains checkpoint-reprompt `WriteLoopInput` fields — merge-order sequencing, not observable-now state.
- `retire-checkpoint-resume-replay` is merged to `main` before any implementation run against this spec; on the plan base daemon resume still strips checkpoint-shaped `queuedInput` and negates log-tail replay — merge-order sequencing, not observable-now state.

## Problem

- The durable `LogEvent` contract still exports `mutation_directive_reprompt`, `guard_checkpoint_reprompt`, and `keystone_directive_reprompt` variants and payload types after implement producers, daemon replay consumers, and execution-side reprompt plumbing are gone.

## Decision ledger

- Delete checkpoint event variants and payload types from `v2/src/persistence/log-stream.ts` only after implement emission and daemon replay are retired on `main`; rules out a partially live schema where append types outlive producers or consumers still import them.
- Historical JSONL lines remain readable through the existing line-oriented parser without kind-specific branches or a parallel untyped reader; rules out breaking tail inspection of old runs or preserving retired typed append surface.
- Remove dead `WriteLoopInput` checkpoint-reprompt fields, `awaitIteration`/`buildWriteExecuteInput` checkpoint-reprompt parameters, and `write-loop.test.ts` checkpoint-reprompt helper args together with log-type deletion; those execution/daemon touches are compile-time/schema coupling deferred from siblings — not additional runtime behavior beyond deleting types that exist only for retired log kinds.
- After checkpoint reprompt fields leave `WriteLoopInput`, retain `reconstructDirectWriteResume` stripping of `initialIterationsConsumed` only — stale-row defense for persisted paused rows that still carry checkpoint-shaped `queuedInput`; rules out blind removal of the entire strip or pass-through of raw `queuedInput` that revives checkpoint-derived iteration budget.
- Retired kinds need no dedicated log-follow formatter cases — generic `seq=` / `kind=` projection suffices for historical tails; rules out adding throwaway formatting for deleted event families.
- Operator-runbook interim “until log-schema deletion” wording is removed in this change; rules out leaving stale hand-repair guidance after the schema retires.

## Tasks

- Remove `MutationDirectiveReprompt*`, `KeystoneDirectiveReprompt*`, `GuardCheckpointReprompt*`, and `GuardCheckpointRepairEntry` exports and the three checkpoint variants from the `LogEvent` union in `v2/src/persistence/log-stream.ts`.
- Replace `log-stream.test.ts` test `guard checkpoint reprompts round-trip in directive-event order` with a historical-tolerance pin that writes a raw checkpoint JSONL line and asserts `tail()` returns the full parsed payload while typed `LogEvent` append no longer accepts checkpoint kinds.
- Update `daemon-resume.test.ts` historical checkpoint tail fixtures to construct records without the retired `LogEvent` variants (inline objects or raw JSONL) while preserving ignore-replay assertions.
- Delete dead checkpoint-reprompt fields from `WriteLoopInput`, the write-loop pending-reprompt plumbing, `awaitIteration`/`buildWriteExecuteInput` checkpoint-reprompt parameters, and the checkpoint-reprompt helper args in `v2/src/execution/write-loop.test.ts`.
- In `reconstructDirectWriteResume`, remove checkpoint-reprompt field strips from `queuedInput` destructuring but retain `initialIterationsConsumed` strip only — do not delete the whole strip or pass through raw `queuedInput`.
- Align durable docs listed below: retire interim schema-deletion forward references and checkpoint-kind live-contract naming at the anchored prose sites.

## Acceptance criteria

- [ ] `v2/src/persistence/log-stream.test.ts` test `historical checkpoint reprompt records remain tail-readable without typed append contract` writes a raw `guard_checkpoint_reprompt` JSONL line, asserts `tail()` round-trips `runId`, `seq`, `ts`, `kind`, and payload fields, and uses a compile-time `@ts-expect-error` (or equivalent) to prove checkpoint kinds are not assignable to `LogEvent`; it fails against the pre-fix path reachable via `log-stream.test.ts` test `guard checkpoint reprompts round-trip in directive-event order`.
- [ ] Production exports and the appendable `LogEvent` union contain no `mutation_directive_reprompt`, `guard_checkpoint_reprompt`, or `keystone_directive_reprompt` kind or checkpoint-reprompt payload type; reachable on `main` via `v2/src/persistence/log-stream.ts` exports and union members named in that test file's historical fixture.
- [ ] `v2/src/daemon/daemon-resume.test.ts` test `paused direct write resume strips stale checkpoint queuedInput without seeding iteration budget` (or equivalent) persists a paused direct-write row whose `queuedInput` JSON still carries retired checkpoint reprompt keys and `initialIterationsConsumed`; asserts the resumed write input omits checkpoint reprompt fields and does not inherit the stripped `initialIterationsConsumed` seed; fails against the pre-fix path if checkpoint fields pass through or iteration budget is revived from stale `queuedInput`.
- [ ] `v2/src/persistence/log-stream.test.ts` — `tail returns only the specified run's events in ascending seq order starting at 1`, `append succeeds when the trailing line is truncated`, `tail skips a truncated trailing line instead of throwing`, `follow yields existing events from seq 1, then new appends in order`, and `follow stops without error when AbortSignal aborts` stay green.
- [ ] `v2/src/tui/tui-log-follow-entry.test.tsx` — `formatLogFollowLine` tests `projects per-kind fields from decisions` and `omits absent per-kind fields from partial payloads` stay green.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `paused implement resume ignores historical checkpoint reprompt log events`, `paused implement resume restores landing-contract but ignores checkpoint reprompt when co-present`, `paused direct implement resume ignores historical checkpoint reprompt log events`, and `resumes paused intent-split write loop with landing-contract reprompt context from log` stay green.
- [ ] `v2/docs/operator-runbook.md` — the `landing_failed` resume paragraph no longer contains ``until log-schema deletion in `retire-checkpoint-log-events` `` and states historical checkpoint log tails remain tail-readable but do not restore reprompt context or checkpoint-derived iteration accounting on resume.
- [ ] `v2/docs/write-behavior.md` — daemon-resume paragraph no longer names `mutation_directive_reprompt`, `guard_checkpoint_reprompt`, or `keystone_directive_reprompt` as live replay kinds; cross-links `v2/src/persistence/log-stream.ts` as the appendable log contract.
- [ ] `v2/docs/v1-behaviors.md` — daemon no-replay behavior entry no longer names checkpoint reprompt log kinds in live-contract voice.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — retire replay-negation prose that names checkpoint reprompt kinds as live contract; retain landing-contract and staged-Markdown-lint reprompt events; cross-link `v2/src/persistence/log-stream.ts` as the generic appendable log contract.
- `v2/docs/v1-behaviors.md` — retire checkpoint-reprompt log-kind naming from the daemon no-replay durable-behavior entry; retain the entry without naming retired kinds as live contract.
- `v2/docs/operator-runbook.md` — remove interim ``until log-schema deletion in `retire-checkpoint-log-events` `` forward reference; state that historical checkpoint log tails remain tail-readable but do not restore reprompt context or checkpoint-derived iteration accounting on resume — operators should restart or hand-repair.
