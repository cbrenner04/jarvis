---
name: chained-stage-project-match-covers-git-disabled-workspaces
---

# Chained pipeline stages resolve the project for git-disabled workspaces

## Problem

`createChainedStageProjectMatch` (`v2/src/daemon/pipeline-stage-resolve.ts`) maps a prior stage's workspace path back to a registered project only for paths under the project root or `~/.jarvis/worktrees/<key>/`. Git-disabled workspaces live elsewhere — intent stages in `~/.jarvis/intent-work/<safeId>/<slug>` and plan landings in `~/.jarvis/specs/<safeId>/plans/<name>` (`projectSafeId` transform in `publication-workflow-steps.ts:108`) — so on a `plan.commit: false` project the chained plan stage fails dispatch with `plan: no registered project matches ~/.jarvis/intent-work/<safeId>/<slug>` (#3119). The chained implement stage after a git-disabled plan would fail identically at `resolveImplementStage`'s matcher call. Every full-review pipeline on such a project dies at intent→plan.

## Evidence (2026-08-29, #3119)

Pipeline `580ccff3` (homestead-service, `plan.commit: false`), lane `household-tenant-persistence`: intent stage succeeded post-#3112 and landed three ready-intents; plan stage failed instantly with the message above. Operator workaround: abandon the pipeline, copy external ready-intents into the repo, drive `plan` manually per lane.

## Decisions

- `createChainedStageProjectMatch` additionally maps paths under `~/.jarvis/intent-work/<projectSafeId(key)>/` and `~/.jarvis/specs/<projectSafeId(key)>/` to `{key, root: admissionRoot}` — same shape as the existing external-worktrees branch, iterating registry keys and computing each key's safe id. Project identity thus derives from admission context, as #3119 requests; the prior workspace path is only the lookup key. Rules out threading a separate project field through stage artifacts (larger schema change).
- `projectSafeId` moves to (or is exported from) a shared location so the matcher and publication steps use one definition. Rules out a duplicated transform drifting.
- Out of scope: `--ready-intent` accepting the external `~/.jarvis/specs/<safeId>/ready-intents/` landing dir (issue's secondary suggestion — separate UX seed if the manual path recurs); fan-out lane semantics.

## Acceptance criteria

- [ ] A `pipeline-stage-resolve` test proves the matcher maps a path under `~/.jarvis/intent-work/<safeId>/<slug>` for a registered key to `{key, root: admissionRoot}`; it fails against the current matcher.
- [ ] A companion test proves the same for `~/.jarvis/specs/<safeId>/plans/<name>` (the chained-implement-after-git-disabled-plan case).
- [ ] A test proves a key needing the safe-id transform (e.g. containing `/`) still matches via its transformed path segment.
- [ ] An unmatched path outside all known roots still returns the direct-match fallback (no regression), pinned by an existing or new test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` or `v2/docs/pipeline-execution.md` (whichever owns chained-stage resolution) — chained stages resolve projects for managed git-disabled workspace roots, naming both roots.
