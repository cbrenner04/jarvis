# Surviving-mutation reprompt resume parity

## Problem

Pause/resume must replay in-loop surviving-mutation reprompt context the same way landing and staged-Markdown reprompts do, or a paused implement run loses the mutation miss on resume.

## Decision ledger

- Add `findSurvivingMutationRepromptFromLog` mirroring `findLandingContractRepromptFromLog` / `findStagedMarkdownLintRepromptFromLog` and wire it through workflow-snapshot `reconstructWriteResume` in `daemon.ts`; rules out resume dropping reprompt context or requiring operator re-seeding on workflow implement runs.
- Surviving-mutation reprompt replay is scoped to workflow-snapshot `reconstructWriteResume` only; `reconstructDirectWriteResume` omits landing, staged-Markdown, and surviving-mutation reprompt context by design (same limitation as today); rules out claiming universal pause/resume parity across direct-write runs.

## Prerequisites

- Subspec 00 emits `surviving_mutation_reprompt` with structured mutation and source-site fields.

## Task checklist

- Export `findSurvivingMutationRepromptFromLog` from `write-loop.ts` (log-tail scan for the last `surviving_mutation_reprompt`).
- Thread `survivingMutationReprompt` through `reconstructWriteResume` / `resolveWriteLoopBindings` like existing landing and staged-Markdown reprompt fields; do not extend `reconstructDirectWriteResume`.
- Add `daemon-resume.test.ts` regression: paused workflow implement run with a persisted `surviving_mutation_reprompt` tail resumes with `survivingMutationReprompt` populated on the reconstructed `WriteLoopInput`.

## Acceptance criteria

- [ ] `daemon-resume.test.ts` `paused implement run resumes surviving mutation reprompt context` reconstructs `WriteLoopInput.survivingMutationReprompt` from the persisted `surviving_mutation_reprompt` log tail after pause on a workflow-snapshot implement run; fails against the pre-fix resume path that omits surviving-mutation reprompt replay.

## Documentation updates

- Deferred to subspec 04 (direct-write reprompt gap documented there).
