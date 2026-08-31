---
name: pipeline-resume-resolves-chained-input-from-durable-artifact
---

# Pipeline resume resolves chained input from durable artifact

Unsplit rationale: Chained downstream-input resolution, durable fallback when prior worktrees are absent, distinct never-landed refusals, and resume continuation all live on the daemon pipeline stage-resolution and resume boundary; execution-loop preset builders consume the resolution context they already receive.

## Primary implementation surface

- Daemon pipeline stage resolution and resume in `v2/src/daemon/`

## Prerequisites

- Chained plan and implement stages resolve downstream inputs from the prior workflow stage's entry-run worktree when that worktree exists on disk.
- Pipeline stage workflow preparation routes preset building through shared workflow-start preparation.

## Problem

- Chained stage resolution verifies downstream inputs only on the prior entry-run worktree path; when that worktree was removed, `pipeline resume` refuses pre-dispatch with `not found in prior worktree` even though the input is durably on the prior stage branch or project base.
- The dirty-gate workaround (manual worktree removal) therefore strands resume; the lane is unrecoverable in-pipeline.

## Behavior

- Chained plan and implement stage resolution falls back from the prior worktree to the prior stage branch recorded on the artifact, then to the pipeline admission project base, when locating downstream ready-intent or spec paths.
- `pipeline resume` of a chained stage whose prior worktree is absent rematerializes or re-resolves from durable sources and dispatches instead of refusing at stage resolution.
- A downstream input that never landed anywhere durable refuses with a distinct named reason that points at standalone re-drive, not the generic prior-worktree message.
- When the prior worktree is present, chained resolution behavior is unchanged.

## Decisions

- Resolve downstream inputs from the durable landed artifact when the prior worktree is absent; rules out fail-hard the moment a worktree is cleaned.
- Empty or missing `worktreePath` metadata stays a hard error (reachable on `pipeline-stage-resolve.test.ts` — `missing prior artifact, entryRunId, entry run, or worktreePath returns resolution failure without falling back to context.cwd`); only a recorded path whose directory is absent triggers durable fallback.
- Deferred to first consumer: exact git ref walk order when both prior branch and project base carry the path — pin when a caller needs it.
- Never-landed downstream input refusals use a stable, grep-able `pipeline-stage-resolve:` reason distinct from `not found in prior worktree` and pointing at standalone re-drive; rules out one opaque prior-worktree message for two states.
- Fold durable read-root selection into stage resolution before preset build; rules out requiring the prior worktree to survive for recovery.

## Acceptance criteria

- [ ] `pipeline-stage-resolve.test.ts` — `plan stage falls back to prior branch when recorded prior worktree directory is absent` and `implement stage falls back to prior branch when recorded prior worktree directory is absent` resolve downstream inputs from the durable prior branch or project base; they fail against the pre-fix prior-worktree-only verifier.
- [ ] `daemon-pipeline-resume.test.ts` — `pipeline_resume dispatches chained plan and implement stages after prior worktree removal when input lives on durable branch` proves resume admission and dispatch, not resolution alone; it fails against the pre-fix resume refusal at stage resolution.
- [ ] `pipeline-stage-resolve.test.ts` — `downstream input never landed anywhere durable refuses with distinct named reason pointing at standalone re-drive` asserts a stable `pipeline-stage-resolve:` reason distinct from `not found in prior worktree`; it fails against the pre-fix error string.
- [ ] `pipeline-stage-resolve.test.ts` — `plan stage resolves chained readyIntent from the intent entry-run worktree, not admission cwd`, `implement stage resolves chained specPath from the plan entry-run worktree with prior branch as baseRef`, `plan stage resolves through real preset builders when ready-intent exists only on intent worktree`, and `implement stage resolves through real preset builders when plan spec exists only on plan worktree branch` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline resume recovers chained inputs from the durable landed artifact; clearing a stage worktree no longer permanently strands resume.
- `v2/docs/pipeline-execution.md` — chained downstream-input resolution falls back from prior worktree to durable artifact.
- `v2/docs/v1-behaviors.md` — record the changed chained inter-stage handoff semantics against the parity baseline.
