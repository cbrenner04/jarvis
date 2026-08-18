# 02 - Admit branch-scoped recovery over the daemon RPC

## Problem

Branch-scoped blocked-stage recovery is reachable only in-process. No RPC admits it, so no operator surface can request it, and nothing proves recovery stays opt-in rather than firing from daemon restart continuation.

## Decision ledger

- A new `pipeline_recover` RPC takes required non-empty `pipelineId` and `branchKey`; rules out overloading `pipeline_resume` with a mode flag, which would silently change a replay verb's meaning for `resumable: false` stages, and rules out an optional branch key defaulting to whole-pipeline recovery across sibling gates.
- The branch admission-and-recovery function the handler calls takes the same `{ detachContinuation?: boolean }` shape `resumePipeline` already exposes: the RPC handler always passes `true` and returns `{ kind: "admitted" }` or the named refusal synchronously while the attempt, settlement, and branch continuation run detached — a recovery attempt re-invokes review agents, so the client connection cannot be held for it, and the outcome is observable on the stage row through `pipeline_list`; `daemon-pipeline-recover.test.ts` calls the same function directly with `detachContinuation: false` to observe settlement deterministically without polling. Rules out ACs that assert post-attempt state against the always-detached RPC response with no seam to await it.
- The handler registers the detached attempt in the daemon's `activeRuns` map (mirroring `resumeFinalizationOnly`'s `activeRuns.set(...)`/delete-in-`finally` pattern, extending the closed `ActiveRun` union with a recovery kind) before running it and removes the entry when it settles; `hasActiveRuns()` — what `shouldShutdownNow` consults — reports true while recovery is in flight, so a retiring daemon does not shut down out from under it.
- The handler claims the linked run's `(project, branch)` worktree ownership before admitting and releases it when the attempt settles, refusing `worktree_claimed` when held; rules out running an in-process workflow on a worktree another run owns.
- A retiring daemon refuses `daemon_superseded`, matching the other mutating pipeline RPCs.
- Restart reconciliation is unchanged: the daemon's `continueContinuablePipelines` alias (which wraps the execution-layer `recoverContinuablePipelines` in `pipeline-execution.ts` — an unrelated, pre-existing use of "recover" for restart reconciliation, not this recovery verb) never invokes the recovery seam and never auto-recovers a blocked stage, so recovery is operator-requested only.
- Deferred, named: an operator-facing client (CLI command or TUI action) for `pipeline_recover`. Until it lands, the motivating incident stays operator-unrecoverable through any first-party surface even though the daemon RPC accepts the request; track it as a successor intent rather than a passing note, since it is what closes the loop this intent opens.

## Task checklist

- Register `pipeline_recover` in `v2/src/daemon/daemon.ts`'s handler map, validating params, honoring `retiring`, claiming and releasing worktree ownership, registering/deregistering the attempt in `activeRuns`, layering a log sink onto the injected recovery attempt seam, and detaching the admitted attempt via the same `detachContinuation` shape `resumePipeline` uses.
- Add `v2/src/daemon/daemon-pipeline-recover.test.ts` covering admitted recovery, refusals, restart isolation, and retirement.
- Add in-body `// @mutate` directives on stable, unique production lines for the keystone and every added validation, retirement, ownership, and `activeRuns` registration guard.
- Update `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-pipeline-recover.test.ts` test `pipeline_recover admits one branch and advances it without redrafting` fails against the pre-fix code, then, driving the admission-and-recovery function with `detachContinuation: false` for deterministic observation, proves it returns an admitted response for a fan-out pipeline's blocked plan branch, the target stage settles `succeeded`, that branch's `approve-plan` gate row moves to `awaiting` with no downstream workflow stage dispatched, the write step's binding factory records zero draft-agent invocations, and two sibling `approve-intent` gate rows and their branch rows are byte-for-byte unchanged.
- [ ] `v2/src/daemon/daemon-pipeline-recover.test.ts` test `pipeline_recover refuses invalid params, an unresolvable target, and a retiring daemon` proves a missing or empty `pipelineId` or `branchKey` returns `invalid_params`, an unresolvable target returns its named resolution refusal (subspec `00`), a `(project, branch)` already claimed in the ownership registry returns `worktree_claimed`, and a retiring daemon returns `daemon_superseded` — each with no stage-row mutation and no dispatch.
- [ ] `v2/src/daemon/daemon-pipeline-recover.test.ts` test `a retiring daemon waits for an in-flight detached recovery` proves that once `pipeline_recover` has admitted and detached an attempt, `hasActiveRuns()` reports true and a subsequent retirement check does not shut down until the attempt settles and its `activeRuns` entry is removed.
- [ ] `v2/src/daemon/daemon-pipeline-recover.test.ts` test `daemon restart continuation never auto-recovers a blocked plan stage` proves invoking the daemon's `continueContinuablePipelines` alias over a pipeline whose branch plan stage is `failed` with a populated staging tree leaves that row `failed`, invokes the recovery seam zero times, and dispatches no stage.
- [ ] `v2/src/daemon/daemon-pipeline-recover.test.ts` — `pipeline_recover admits one branch and advances it without redrafting`; Keystone checkpoint: an in-body `// @mutate` directive neutering the handler's detached recovery dispatch restores an admission-only no-op and turns this regression red.
- [ ] `v2/src/daemon/daemon-pipeline-recover.test.ts` — `pipeline_recover refuses invalid params, an unresolvable target, and a retiring daemon`; Mutation checkpoint: in-body directives invert every added param-validation, retirement, and worktree-ownership guard on its real production line; each mutation turns this test red, and the assertions prove the otherwise-suppressed recovery dispatch is absent.
- [ ] `v2/src/daemon/daemon-pipeline-recover.test.ts` — `a retiring daemon waits for an in-flight detached recovery`; Mutation checkpoint: an in-body directive removing the handler's `activeRuns` registration for the detached attempt on its real production line turns this test red, proving the otherwise-suppressed premature shutdown is absent.
- [ ] `v2/src/daemon/daemon-pipeline-resume.test.ts` and `v2/src/daemon/daemon-pipeline-approval.test.ts` stay green (ordinary `pipeline_resume`, `pipeline_approve`, and `pipeline_reject` semantics unchanged).
- [ ] `v2/docs/daemon-host.md` documents `pipeline_recover`: required params and `invalid_params`, `daemon_superseded`, `worktree_claimed`, the admitted-then-detached response contract and its `detachContinuation`-style test seam, why the response does not carry the attempt outcome, where the outcome is observable (`pipeline_list` stage `failureDetail`), `activeRuns` registration so a retiring daemon waits for an in-flight recovery, that restart continuation (the daemon's `continueContinuablePipelines` alias over the execution-layer `recoverContinuablePipelines`) never auto-recovers, and disambiguates that unrelated "recover" naming from this recovery verb.
- [ ] `v2/docs/v1-behaviors.md` records the additive v2 daemon recovery of one operator-corrected pipeline branch plan stage: opt-in RPC only, branch-scoped settlement and continuation, sibling and gate isolation, no automatic recovery on restart, and that an operator-facing client is a deferred successor.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — `pipeline_recover` params, refusals, admitted-then-detached response and its test seam, outcome observability, `activeRuns`/retirement interaction, restart isolation, and "recover" naming disambiguation.
- `v2/docs/v1-behaviors.md` — additive daemon recovery for one operator-corrected pipeline branch stage, and the deferred operator-facing client.

## Implementer notes

- `createRunControlHandlers` in `v2/src/daemon/daemon.ts` already accepts injected `resolveStage`, `pipelineDispatch`, and `pipelineWait` seams (`v2/src/daemon/daemon-pipeline-resume.test.ts` is the harness pattern); add the recovery attempt seam the same way so the RPC test does not invoke real agents.
- `resumeFinalizationOnly` is the existing precedent for claiming ownership, layering a log sink, registering/deregistering in `activeRuns`, and settling an in-process attempt; follow its claim/release and `activeRuns` discipline rather than inventing a second one.
- Register the method alongside `pipeline_resume` in the `handlersOut` map so retirement and transport behavior stay uniform.
- `resumePipeline`'s `options.detachContinuation` (`pipeline-execution.ts`) is the precedent for the toggle: production always passes `true`; call the underlying function directly with `false` in tests that need synchronous settlement instead of polling with `flushBackgroundRuns`/`waitFor`.
