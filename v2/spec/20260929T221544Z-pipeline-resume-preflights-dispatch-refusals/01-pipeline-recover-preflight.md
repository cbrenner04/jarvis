# 01 — `pipeline recover` preflights re-dispatch refusals

## Problem

`pipeline_recover` (`v2/src/daemon/daemon-pipeline-handlers.ts`) admits and detaches the recovery lifecycle; a re-dispatch refusal then surfaces only as a `stage-failed` incident.

## Decisions

- Recover's re-dispatch reaches the stale-reset gate through `staleReset.run` (`maybeResetStaleWorkspace`) wired in `v2/src/daemon/pipeline-workflow-preparation.ts` via stage resolution, not only the `advanceWorkflowStage` preflight; the probe targets the stage recover resolves and evaluates the gates that path actually hits (verify against code while implementing; if it hits none beyond subspec 00's, recover reuses 00's probe unchanged).
- Reuse subspec 00's non-mutating probe (same stage-resolution, option-builder, gate-order, and `worktree_claimed`/rebase-conflict exclusions) after target resolution and before detaching; a recover-only check would drift from the resume one.
- Probe builds options through `buildResetStaleWorkspaceOptions` from the recover params' flags, so every override dispatch honors applies at admission.
- A refusal returns an RPC error frame carrying the exact dispatch refusal line and detaches nothing.
- Dispatch-time gates are unchanged; a refusal appearing between admission and dispatch still settles `failed`.

## Acceptance criteria

- [ ] A new test drives `pipeline_recover` against a real git fixture whose re-dispatch would be refused by the dirty-worktree gate; it returns an RPC error frame with the reason and creates no new run row, and `jarvis pipeline recover` prints the reason on stderr with a non-zero exit; fails against the pre-fix admitted outcome / exit 0.
- [ ] A test shows `resetDespiteDirty` on the same fixture admits `pipeline_recover` (recover override wiring).
- [ ] `v2/src/daemon/daemon-pipeline-recover.test.ts` stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — `pipeline recover` refusals print their reason and exit non-zero.
- `v2/docs/daemon-host.md` — `pipeline_recover` admission returns pre-dispatch refusals.
- `v2/docs/v1-behaviors.md` — record the changed pipeline-recover admission behavior.
