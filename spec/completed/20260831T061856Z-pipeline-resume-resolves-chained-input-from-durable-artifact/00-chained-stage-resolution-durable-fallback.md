# Chained stage resolution durable fallback

## Primary implementation surface

Daemon pipeline stage resolution in `v2/src/daemon/pipeline-stage-resolve.ts`.

## Problem

Chained plan and implement stages verify downstream inputs only on the prior entry-run `worktreePath`. When that directory was removed (for example after a dirty-gate workaround), resolution refuses with `pipeline-stage-resolve: downstream input … not found in prior worktree` or `pipeline-stage-resolve: expected index at … in prior worktree` even though the ready-intent or spec path is durably on the prior stage branch or pipeline admission project base. Locator-only success still leaves preset build bound to the removed worktree and strands operators at `validateReadyIntent` / implement preflight.

## Decision ledger

- Durable read-root walk **order** is prior stage branch, then pipeline admission `context.cwd`; **content precedence when both roots carry the path** stays deferred until a caller needs it.
- Durable rebinding applies only when `!existsSync(recordedWorktreePath)`; it does not revive worktree-vs-admission ownership predicates when the recorded worktree directory is present.
- When the recorded prior `worktreePath` directory is absent, a shared locator discovers worktree-relative ready-intent and implement spec paths on durable roots in that order; per-workflow read-root binding after discovery is asymmetric:
  - **Plan:** bind preset `cwd` to admission `context.cwd` when the ready-intent exists there; when it exists only on `prior.branch`, rematerialize a checkout at the recorded `worktreePath` from `prior.branch` and bind `cwd` to that rematerialized root so `validateReadyIntent` / `WORKFLOW_PRESET_BUILDERS.plan` read from disk.
  - **Implement:** keep `baseRef` on `prior.branch`; bind `preflightGitRoot` / `specReadRoot` to admission `context.cwd` when the spec tree exists there, otherwise rematerialize at the recorded `worktreePath` from `prior.branch` and bind preflight roots to that checkout so chained implement preflight and spec reads succeed.
- Plan recovery is rematerialization for branch-only ready-intents plus admission-root binding when the path is on disk at `context.cwd`; rules out plan recovery that stops at locator success without rebinding `prior.cwd`.
- Empty or missing `worktreePath` metadata stays a hard error (`missing prior artifact, entryRunId, entry run, or worktreePath returns resolution failure without falling back to context.cwd` in `pipeline-stage-resolve.test.ts`); only a non-empty recorded path whose directory is absent triggers durable fallback.
- **No fallback** when the worktree directory exists but the downstream file is missing — worktree-first refusal unchanged (stale nonempty worktree).
- **Out of scope:** git-disabled / external-workspace chained recovery when the prior worktree directory is removed (branch fallback needs git; admission fallback needs on-disk presence).
- Never-landed downstream input refusals emit one stable `pipeline-stage-resolve:` reason for both workflows, grep-able for `never landed` and standalone re-drive guidance, distinct from `not found in prior worktree` and `expected index at … in prior worktree`; rules out one opaque prior-worktree message for two states.
- Fold durable read-root selection into stage resolution before preset build; rules out requiring the prior worktree to survive for recovery.
- When the prior worktree directory is present, chained resolution behavior is unchanged; rules out regressing the existing worktree-first path pins in `pipeline-stage-resolve.test.ts`.

## Tasks

- Add a shared downstream-input locator in `pipeline-stage-resolve.ts` that checks the prior worktree when its directory exists, then walks durable roots in order (`prior.branch`, then admission `context.cwd`) for worktree-relative ready-intent and implement spec paths.
- After locator success with an absent recorded worktree directory, rebind per-workflow read roots before preset build: plan `cwd` per the plan binding rules above; implement `preflightGitRoot` / `specReadRoot` with `baseRef` still on `prior.branch`.
- Add branch-only rematerialization at the recorded `worktreePath` from `prior.branch` when the downstream path is absent from admission `context.cwd` (reuse existing external-worktree materialization patterns).
- Route `verifyChainedReadyIntentPath`, `resolveChainedReadyIntentPaths`, and `resolveChainedImplementSpecPath` through the locator; keep `resolvePriorArtifactContext` validation for missing artifact, `entryRunId`, entry run, and empty `worktreePath`/`branch` unchanged.
- Emit the unified never-landed refusal when the downstream path is absent from every durable root.
- Add `plan stage falls back to prior branch when recorded prior worktree directory is absent` and `implement stage falls back to prior branch when recorded prior worktree directory is absent` to `pipeline-stage-resolve.test.ts` with real git fixtures and `WORKFLOW_PRESET_BUILDERS`: commit the downstream input on the prior stage branch, record a prior entry run whose `worktreePath` points at a removed directory, and assert `resolveStageWorkflowSteps` succeeds through real preset builders (write step present), not only `fakeBuilders` returning expected path strings.
- Add `plan stage falls back to admission project base when recorded prior worktree directory is absent` to `pipeline-stage-resolve.test.ts` with a fixture where the downstream path exists at pipeline admission `context.cwd` but not on `prior.branch`, asserting real preset-builder success.
- Add `downstream input never landed anywhere durable refuses with distinct named reason pointing at standalone re-drive` to `pipeline-stage-resolve.test.ts` covering both chained plan and chained implement with grep-able `never landed` and standalone re-drive substrings.
- Update `v2/docs/pipeline-execution.md` and `v2/docs/v1-behaviors.md` per Documentation updates.

## Acceptance criteria

- [x] `pipeline-stage-resolve.test.ts` — `plan stage falls back to prior branch when recorded prior worktree directory is absent` resolves the chained ready-intent from the durable prior branch and succeeds through `WORKFLOW_PRESET_BUILDERS` with the recorded worktree removed; it fails against the pre-fix prior-worktree-only verifier (reachable on main: `verifyChainedReadyIntentPath` returns `not found in prior worktree` when `existsSync(join(prior.worktreePath, path))` is false and `resolvePlanStage` still binds `cwd` to the removed worktree).
- [x] `pipeline-stage-resolve.test.ts` — `implement stage falls back to prior branch when recorded prior worktree directory is absent` resolves the chained spec path from the durable prior branch and succeeds through `WORKFLOW_PRESET_BUILDERS` with the recorded worktree removed; it fails against the pre-fix prior-worktree-only verifier (reachable on main: `resolveChainedImplementSpecPath` checks only `join(worktreePath, indexPath)` and `resolveImplementStage` binds `preflightGitRoot` to the removed worktree).
- [x] `pipeline-stage-resolve.test.ts` — `plan stage falls back to admission project base when recorded prior worktree directory is absent` resolves when the ready-intent exists only at pipeline admission `context.cwd` (not on `prior.branch`) and succeeds through `WORKFLOW_PRESET_BUILDERS`; it fails against the pre-fix branch-only locator (reachable on main: resolution never consults admission `context.cwd` when the worktree directory is absent).
- [x] `pipeline-stage-resolve.test.ts` — `downstream input never landed anywhere durable refuses with distinct named reason pointing at standalone re-drive` asserts one stable `pipeline-stage-resolve:` reason for chained plan and chained implement, grep-able for `never landed` and standalone re-drive guidance, distinct from `not found in prior worktree` and `expected index at … in prior worktree`; it fails against the pre-fix error strings (reachable on main: absent inputs surface only the worktree-missing strings above).
- [x] `pipeline-stage-resolve.test.ts` — `plan stage resolves chained readyIntent from the intent entry-run worktree, not admission cwd`, `implement stage resolves chained specPath from the plan entry-run worktree with prior branch as baseRef`, `plan stage resolves through real preset builders when ready-intent exists only on intent worktree`, and `implement stage resolves through real preset builders when plan spec exists only on plan worktree branch` stay green.
- [x] `v2/docs/pipeline-execution.md` documents chained downstream-input resolution falling back from the prior entry-run worktree to the prior stage branch and pipeline admission base when the recorded worktree directory is absent, including per-workflow read-root rebinding and branch-only rematerialization.
- [x] `v2/docs/v1-behaviors.md` records the changed chained inter-stage handoff semantics against the parity baseline.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — chained downstream-input resolution falls back from prior worktree to durable artifact (prior stage branch, then admission project base) when the recorded worktree directory is absent; plan `cwd` and implement `preflightGitRoot`/`specReadRoot` rebind before preset build, with branch-only rematerialization at the recorded worktree path; worktree-present behavior unchanged.
- `v2/docs/v1-behaviors.md` — update the pipeline inter-stage handoff bullet to record durable fallback, read-root rebinding, and the distinct never-landed refusal.
