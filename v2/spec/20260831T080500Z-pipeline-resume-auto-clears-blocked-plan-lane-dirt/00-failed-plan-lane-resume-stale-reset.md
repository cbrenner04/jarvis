# Failed plan-lane resume stale reset

## Primary implementation surface

Daemon pipeline resume and stale-reset dispatch in `v2/src/daemon/`.

## Problem

Reopening a failed plan stage redispatches its writer but shared stale reset treats the blocked lane's expected uncommitted `.jarvis-plan-stage/` draft as ordinary dirty reuse. Branch-scoped fan-out resume therefore fails before dispatch until the operator abandons the worktree manually, even though redraft discards that staged tree by design.

## Decision ledger

- A resumed `failed` plan stage automatically skips only the dirty-worktree gate for that redraft in whole-pipeline and branch-scoped forms; rules out manual `cleanup --abandon` for ordinary blocked-plan dirt and broad reset changes for other stage states or workflows.
- Resume retirement uses shared `maybeResetStaleWorkspace` / `resetStaleWorkspace` and rematerializes from the resolved base before writer dispatch; rules out a parallel deletion path with different teardown semantics.
- A remaining staged `## Blocker` refuses plan redraft before destructive retirement and names `operator blocker`; rules out deleting an unresolved operator decision as ordinary draft dirt.
- Live-run/worktree ownership and non-descendant `HEAD` refusals remain unskippable even when reset-override RPC fields are true; rules out treating either override as unconditional abandonment.
- Automatic failed-plan redraft does not skip the landed-criteria gate; rules out discarding landed acceptance work merely because the dirty gate is automatic.
- `pipeline_resume` accepts `resetDespiteDirty` and `resetDespiteLandedCriteria` RPC booleans and threads each only to its matching shared stale-reset flag; rules out one override bypassing both gates.
- `pipeline_recover` accepts the same RPC fields but does not invoke stale reset; rules out redrafting or deleting the corrected staged tree recovery is meant to land.
- CLI admission of reset-override flags is out of scope; rules out changing `pipeline resume` or `pipeline recover` command grammar before the follow-up intent.
- Deferred to first consumer: malformed reset-override RPC value admission — pin when a caller needs it.
- Intent-stage pipeline re-dispatch and standalone plan/implement stale-reset policy stay unchanged; rules out widening failed-plan resume disposal into shared defaults.

## Tasks

- Carry resume-only reset policy and the two optional RPC override values from `pipeline_resume` through whole-pipeline or branch-scoped continuation into the reopened workflow stage's shared stale-reset preparation.
- Auto-skip dirty reuse only when resume is redrafting a reopened failed plan stage; keep landed-criteria, live-run/worktree ownership, and descendant gates independent.
- Refuse destructive reset when the failed plan worktree's staged tree still contains an operator blocker, and preserve the tree and stage failure detail naming that state.
- Admit the two reset-override RPC fields on `pipeline_recover` without passing them to recovery execution or stale reset.
- Add real-git regression coverage for failed plan-lane auto-clear, base rematerialization, dispatch ordering, whole-pipeline and branch-scoped resume, and the preserved guards.
- Add daemon RPC coverage for resume flag threading and recover forwarding parity.
- Update the durable architecture, RPC, operator, and v1-parity docs listed below.

## Acceptance criteria

- [ ] `pipeline-execution.test.ts` drives whole-pipeline and branch-scoped resume of a `failed` plan stage with uncommitted draft paths, proves shared reset removes and rematerializes the lane from base before plan writer dispatch without `cleanup --abandon`, and fails against the pre-fix dirty-reuse refusal.
- [ ] `pipeline-execution.test.ts` proves a live run/worktree claim, a remaining staged `## Blocker`, and a plan worktree `HEAD` not descended from base each refuse before dispatch with the blocking state named in captured stale-reset stderr and stage `failureDetail`, and the worktree preserved, including requests with both reset overrides true; it fails against any implementation that clears through those reachable guards.
- [ ] `daemon-pipeline-resume.test.ts` proves `pipeline_resume` threads `resetDespiteDirty` into the shared dirty-gate reset flag for unscoped and branch-scoped continuation.
- [ ] `daemon-pipeline-resume.test.ts` proves `pipeline_resume` threads `resetDespiteLandedCriteria` into the shared landed-criteria reset flag independently of `resetDespiteDirty`.
- [ ] `daemon-pipeline-recover.test.ts` proves `pipeline_recover` admits requests carrying both reset-override RPC fields while preserving corrected-tree recovery without stale-reset dispatch.
- [ ] `pipeline-execution.test.ts` — `pipeline intent-stage re-dispatch resets a poisoned worktree before the write step` and the existing plan/implement stale-reset refusal pins stay green.
- [ ] `workflow.test.ts` — `run workflow implement refuses reset when the managed worktree is dirty`, `run workflow plan resets a stale worktree before daemon start`, and related landed-criteria and override pins stay green.
- [ ] `v2/docs/pipeline-execution.md` documents resume-only failed-plan dirty disposal, shared stale-reset flag threading, and preserved operator-blocker, live-run/worktree ownership, descendant, and landed-criteria guards.
- [ ] `v2/docs/daemon-host.md` documents the optional `pipeline_resume` / `pipeline_recover` reset-override RPC fields and that recover does not invoke stale reset.
- [ ] `v2/docs/operator-runbook.md` documents automatic dirty-tree retirement on failed plan redraft-resume and reserves manual `cleanup --abandon` for named preserved-refusal cases.
- [ ] `v2/docs/v1-behaviors.md` records failed plan-lane resume auto-clear and its preserved guards against the v1 parity baseline.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/pipeline-execution.md` — resume-only failed-plan dirty disposal through shared stale reset; override threading; operator-blocker, live-run/worktree ownership, descendant, and landed-criteria guard boundaries.
- `v2/docs/daemon-host.md` — optional reset-override RPC fields on resume/recover; recover forwarding parity without stale reset.
- `v2/docs/operator-runbook.md` — failed plan redraft-resume auto-clears ordinary staged-tree dirt; manual abandonment remains for preserved refusals.
- `v2/docs/v1-behaviors.md` — record the changed failed plan-lane resume semantics and v1 gap.
