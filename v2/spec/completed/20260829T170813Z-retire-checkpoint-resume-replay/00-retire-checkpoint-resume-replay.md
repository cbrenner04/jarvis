# Retire checkpoint reprompt replay on daemon resume

## Prerequisites

- `retire-implement-mutation-checkpoint-verification` is merged to `main` before any implementation run against this spec; on the plan base implement checkpoint verification, reprompt prompts, and daemon replay (`findDirectiveRepromptFromLog`, `restoredDirectiveRepromptInput`) are still live — prerequisites are merge-order sequencing, not observable-now state.

## Problem

- Daemon resume still scans durable logs and reconstructs mutation-directive, guard-checkpoint, and keystone-directive reprompt context for an execution path that no longer consumes it after implement-time checkpoint verification retires.

## Decision ledger

- Remove checkpoint replay reconstruction only after `retire-implement-mutation-checkpoint-verification` is merged to `main`; rules out changing live recovery semantics before the sole consumer disappears.
- Delete `findDirectiveRepromptFromLog` and `restoredDirectiveRepromptInput` together with their daemon call sites; rules out leaving a dormant log-tail helper that future resume paths could reattach.
- Do not scan `mutation_directive_reprompt`, `guard_checkpoint_reprompt`, or `keystone_directive_reprompt` events during resume reconstruction; rules out no-op replay that still threads checkpoint-shaped inputs.
- Retain the `queuedInput` checkpoint-field strip in `reconstructDirectWriteResume` until implement retirement removes those fields from `WriteLoopInput`; after log replay retires the strip is stale-row defense only, not paired with replay re-add — rules out deleting strip while persisted paused rows may still carry checkpoint-shaped fields.
- Non-checkpoint resume behavior stays unchanged: landing-contract reprompt restoration, admission paths, and workflow paused respawn — rules out broadening checkpoint cleanup into generic resume behavior.
- Historical checkpoint reprompt log records remain readable until `retire-checkpoint-log-events`; rules out coupling this daemon seam to log-schema deletion. After this change, resuming old paused runs with checkpoint tails restores no reprompt context and no checkpoint-derived `initialIterationsConsumed`; operators may need to restart or hand-repair.
- Producer-side checkpoint prompt docs (`prompts.md` and related implement-retirement doc edits) are owned by `retire-implement-mutation-checkpoint-verification`; rules out parallel doc churn on the same prompt surfaces.

## Tasks

- Remove `restoredDirectiveRepromptInput` from `v2/src/daemon/daemon.ts` and stop spreading checkpoint reprompt fields or checkpoint-derived `initialIterationsConsumed` into `reconstructDirectWriteResume` and `reconstructWriteResume`.
- Delete `findDirectiveRepromptFromLog` from `v2/src/execution/write-loop.ts` once no production caller remains.
- Remove or rewrite the seven checkpoint-replay pins listed in acceptance criteria; add parametrized negative pins that historical checkpoint tail events restore no write-loop reprompt context and do not seed checkpoint-derived `initialIterationsConsumed`, including workflow and direct-write resume paths and co-present checkpoint plus landing-contract tails.
- Align the durable docs listed below in the same change.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-resume.test.ts` test `paused implement resume ignores historical checkpoint reprompt log events` is parametrized over `mutation_directive_reprompt`, `guard_checkpoint_reprompt`, and `keystone_directive_reprompt` (one test, three kinds, matching existing style); each case drives a paused workflow implement resume whose durable tail carries that checkpoint reprompt kind plus a paused `loop_finished` with `iterationsConsumed`, asserts `mutationDirectiveReprompt`, `guardCheckpointReprompt`, `keystoneDirectiveReprompt`, and checkpoint-derived `initialIterationsConsumed` are all absent from the resumed write input, and fails against the pre-fix daemon because replay still restores those fields.
- [x] The same test file includes a direct-write negative pin (extend the parametrized test or replace `resumes a paused direct implement run with guard replay and its original remaining budget`) that asserts a paused direct implement resume with a checkpoint tail restores no checkpoint reprompt fields and no checkpoint-derived `initialIterationsConsumed`, and fails against the pre-fix daemon.
- [x] The negative pin durable tail may co-present checkpoint reprompt events with a landing-contract reprompt event; only landing-contract (non-checkpoint) context is restored — supersession last-wins selection is retired, not replaced.
- [x] `v2/src/daemon/daemon-resume.test.ts` — `resumes paused implement write loop with mutation-directive reprompt context from log`, `resumes paused implement write loop with keystone-directive reprompt context from log`, `resume restores only the later of a mutation-directive reprompt superseded by a keystone one`, `resumes paused implement write loop with guard-checkpoint reprompt context from log`, `resume restores only the newest directive-reprompt context across all three kinds`, `resumed guard repair retains consumed iteration budget`, and `resumes a paused direct implement run with guard replay and its original remaining budget` are removed or rewritten to expect no checkpoint replay restoration.
- [x] `v2/src/daemon/daemon-resume.test.ts` — `resumes paused intent-split write loop with landing-contract reprompt context from log` stays green.
- [x] `v2/src/daemon/daemon-resume.test.ts` — `admits a lint-exhausted populated-stage landing_failed row instead of unsupported_resume_context` stays green.
- [x] `v2/src/daemon/daemon-resume.test.ts` — `resume admits $invocationId reason (composes nextAction: resume)` stays green.
- [x] `v2/src/daemon/daemon-resume.test.ts` — `resume on a workflow paused run respawns with resolved bindings` stays green.
- [x] Daemon resume exposes no checkpoint-specific replay context to execution: `restoredDirectiveRepromptInput` and `findDirectiveRepromptFromLog` are absent from production code.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — remove mutation-directive, keystone-directive, and guard-checkpoint reprompt pause/resume reconstruction while retaining generic resume contracts for landing-contract and staged-Markdown-lint reprompts.
- `v2/docs/operator-runbook.md` — remove checkpoint directive/keystone repair and daemon resume guidance that restores checkpoint reprompt context; add a short legacy note that checkpoint tails on old paused runs no longer restore reprompt context or checkpoint-derived iteration accounting on resume — operators may need to restart or hand-repair until log-schema deletion in `retire-checkpoint-log-events`.
- `v2/docs/v1-behaviors.md` — remove checkpoint replay semantics from the parity baseline while retaining unrelated paused-resume behavior.
