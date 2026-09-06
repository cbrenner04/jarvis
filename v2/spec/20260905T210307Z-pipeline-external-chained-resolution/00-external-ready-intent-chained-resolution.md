# External ready-intent chained resolution

## Primary implementation surface

Daemon: `locateAbsentWorktreeDownstreamInputReadRoot` and chained ready-intent verification in `v2/src/daemon/pipeline-stage-resolve.ts`.

## Problem

`verifyChainedReadyIntentPath` falls through to `locateAbsentWorktreeDownstreamInputReadRoot` when the prior entry-run worktree is absent or unusable. That helper accepts admission-root filesystem presence or `gitPathExistsOnBranch` on the prior branch, so an intent stage's externally landed `ready-intents/<name>.md` under `~/.jarvis/specs/<projectSafeId>/` fails even though the file exists on disk.

## Decision ledger

- After admission-root and git-branch checks fail, accept a downstream ready-intent when it exists on disk under `join(jarvisHome(), "specs", projectSafeId(owner), "ready-intents", …)` for the registered owner resolved from `PipelineContext`; rules out keeping `gitPathExistsOnBranch` as the only absent-worktree fallback for external paths.
- Gate external acceptance on inverted `effectivePublishGit` for the owning project (project `plan.commit`, then machine `modes.plan.commit`, then `true`); rules out project-only `planSourcePublishesExternally` and rules out accepting arbitrary paths under `jarvisHome()/specs/` for in-repo-only projects.
- Reuse the `jarvisHome()/specs/` prefix containment gate `resolveChainedExternalPlanIdentity` already applies to chained implement read roots; rules out inventing a separate external-home predicate for ready-intents.
- Refuse external ready-intent paths under another registered project's `~/.jarvis/specs/<safeId>/` home even when the file exists on disk; rules out longest-prefix or first-match acceptance across project safe IDs.
- Return the external `ready-intents/` directory (or the file's parent when the artifact path is a single file) as `readRoot` for chained plan preset build; rules out rematerializing a git worktree for external-only artifacts.
- Keep git-enabled branch rematerialization, admission-root checks, and in-repo worktree verification unchanged; rules out altering ordinary intent→plan handoff on git branches.

## Tasks

- Extend `locateAbsentWorktreeDownstreamInputReadRoot` (or a shared helper it and `verifyChainedReadyIntentPath` call) to resolve external ready-intent paths under the owning project's `~/.jarvis/specs/<projectSafeId>/ready-intents/` home when inverted `effectivePublishGit` is false.
- Wire `createChainedStageProjectMatch` / machine config so the owner and external-publication predicate are available at resolution time.
- Add `pipeline-stage-resolve.test.ts` regression `resolves external ready-intent downstream input for chained plan stage`: `plan.commit: false` project, prior worktree absent, ready-intent file only under external `ready-intents/`, artifact `specPath` or `downstreamInputs` entry naming `ready-intents/<name>.md`; assert chained plan stage resolves through real preset builders.
- Add `pipeline-stage-resolve.test.ts` regression `resolves external ready-intent downstream input when machine modes.plan.commit is false`: machine `modes.plan.commit: false`, project without explicit `plan.commit`, prior worktree absent, ready-intent only under external `ready-intents/`.
- Add `pipeline-stage-resolve.test.ts` regression `rejects cross-project external ready-intent downstream input`: ready-intent exists only under another registered project's `~/.jarvis/specs/<safeId>/ready-intents/`.

## Acceptance criteria

- [x] `pipeline-stage-resolve.test.ts` test `resolves external ready-intent downstream input for chained plan stage` asserts an intent stage's external `ready-intents/<name>.md` path resolves for the chained plan stage on a `plan.commit: false` project; it fails against the current `gitPathExistsOnBranch` path in `locateAbsentWorktreeDownstreamInputReadRoot`.
- [x] `pipeline-stage-resolve.test.ts` test `resolves external ready-intent downstream input when machine modes.plan.commit is false` asserts chained plan resolution when only machine `modes.plan.commit: false` routes publication externally; it fails against project-only `planSourcePublishesExternally` gating.
- [x] `pipeline-stage-resolve.test.ts` test `rejects cross-project external ready-intent downstream input` asserts resolution fails when the ready-intent exists only under another registered project's external home; it fails against pre-fix external-home lookup that omits owner containment.
- [x] `pipeline-stage-resolve.test.ts` — `plan stage resolves through real preset builders when ready-intent exists only on git-disabled intent workspace` stays green.
- [x] `pipeline-stage-resolve.test.ts` — `plan stage resolves through real preset builders when ready-intent exists only on intent worktree` stays green.
- [x] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- Deferred to `02`–`04`.
