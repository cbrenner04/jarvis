# Replay guard-checkpoint reprompts on daemon resume

## Problem

A paused implement run can durably record a complete guard-checkpoint repair set, but daemon resume reconstructs only mutation-directive and keystone-directive contexts. The resumed iteration therefore loses the guard criteria, resolved pins, reasons, and remaining shared iteration budget.

## Behavior

- On paused implement resume, select the last `mutation_directive_reprompt`, `guard_checkpoint_reprompt`, or `keystone_directive_reprompt` event in the ordered durable log tail.
- A selected guard event restores its complete ordered repair array unchanged, including every checkpoint kind, criterion text, repo-relative pin path, `unlinked` or `hollow` reason, and optional linked-directive identity, so the resumed write iteration renders the same reason-specific instructions.
- Restore exactly one directive-reprompt context and leave both sibling contexts absent.
- Seed a restored directive-reprompt loop with the paused invocation's durable `iterationsConsumed`; the restored prompt consumes only the remaining `maxIterations` allowance.

## Decision ledger

- One ordered three-kind selector owns directive-reprompt replay; rules out independent scans that resurrect superseded sibling contexts.
- Replay persisted guard repair rows verbatim; rules out recomputing checkpoint evidence from a worktree that may have changed while paused.
- A paused resume with a restored directive-reprompt context inherits durable `iterationsConsumed`; rules out granting guard repair a fresh invocation budget.
- Iteration-count inheritance is limited to paused directive-reprompt replay; rules out changing the existing fresh-budget contract for unrelated budget-soft-stop resumes.
- Historical mutation-directive and keystone-directive payloads remain unchanged; rules out a log migration for this additive replay consumer.

## Task checklist

- [ ] Extend directive-reprompt log-tail reconstruction across mutation, guard, and keystone events, returning only the final matching event's context.
- [ ] Thread the selected guard repair array into daemon-reconstructed `WriteLoopInput` and seed paused directive-reprompt resumes from the durable consumed-iteration count.
- [ ] Add daemon resume regressions for full guard payload replay, remaining-budget continuity, and all four guard-versus-existing-kind precedence orders; retain the existing mutation and keystone resume cases.
- [ ] Put `// @mutate` directives inside the named daemon resume pinning tests for every added or modified selection, sibling-clearing, and budget-continuity guard.
- [ ] Update the durable docs listed below.

## Acceptance criteria

- [ ] A paused implement resume restores the `guard_checkpoint_reprompt` context into the resumed write input; `v2/src/daemon/daemon-resume.test.ts` test `resumes paused implement write loop with guard-checkpoint reprompt context from log` fails against the pre-fix daemon because guard context is omitted.
- [ ] The restored guard context preserves every finding's original order, criterion text, resolved repo-relative pin path, reason, and hollow directive identity, asserted by `resumes paused implement write loop with guard-checkpoint reprompt context from log` in `v2/src/daemon/daemon-resume.test.ts`.
- [ ] The resumed write input carries only `guardCheckpointReprompt`; mutation-directive and keystone-directive contexts are absent, and the next write iteration receives the unchanged repair rows used by `write.guard-checkpoint-reprompt`.
- [ ] `v2/src/daemon/daemon-resume.test.ts` test `resume restores only the newest directive-reprompt context across all three kinds` covers guard after mutation, guard after keystone, mutation after guard, and keystone after guard; every case restores only the later event.
- [ ] `v2/src/daemon/daemon-resume.test.ts` test `resumed guard repair retains consumed iteration budget` proves a pause after a guard repair resumes from the durable consumed count and cannot spend a fresh `maxIterations` allowance; it fails against the pre-fix zero-based resumed loop.
- [ ] Existing tests `resumes paused implement write loop with mutation-directive reprompt context from log`, `resumes paused implement write loop with keystone-directive reprompt context from log`, and `resume restores only the later of a mutation-directive reprompt superseded by a keystone one` in `v2/src/daemon/daemon-resume.test.ts` stay green.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `resumes paused implement write loop with guard-checkpoint reprompt context from log`; Keystone checkpoint: reverting guard-event replay to the pre-fix omission turns this pin red.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `resume restores only the newest directive-reprompt context across all three kinds`; Mutation checkpoint: directives invert every added or modified latest-kind and sibling-clearing guard, and the precedence matrix turns red.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `resumed guard repair retains consumed iteration budget`; Mutation checkpoint: inverting every added or modified guard that applies the durable count to paused directive-reprompt replay turns this pin red without changing unrelated soft-stop behavior.
- [ ] `v2/docs/write-behavior.md` canonically records three-kind newest-context replay, verbatim guard repair restoration, paused shared-budget continuity, and the unrelated budget-soft-stop exception; `v2/docs/v1-behaviors.md` links that contract and replaces the deferred guard-replay statement with shipped behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run lint:md` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — canonical three-kind pause/resume replay, guard payload restoration, shared-budget continuity, and unchanged unrelated budget-soft-stop behavior.
- `v2/docs/v1-behaviors.md` — parity-catalog link to the canonical contract and newest-context-only daemon replay including guard events.
