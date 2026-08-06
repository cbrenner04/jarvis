# Implement base retarget when remote ref is absent

## Problem

A `full-review` implement stage opens its draft PR with `--base <plan stage branch>`. Merging the plan PR deletes that base ref on `origin`; `gh pr create` fails, the entry run reports `completion_commit_failed` / `resume`, and the pipeline dies even though publication could succeed against the repository default branch.

## Surface

Primary: `v2/src/execution/completion-publisher.ts`. In-scope: `completion-publisher.test.ts`, `shared/git.ts` (`branchExistsOnOriginAsync`, `getBaseBranch`) as existing helpers, settlement/artifact wiring needed to persist retarget metadata on the stage row (`pipeline-stage-dispatch.ts` artifact/failureDetail fields only as needed).

## Prerequisites

- Subspec 00 landed: settlement liveness and deferred detail.

## Decisions

- **Repository base** means `getBaseBranch(projectRoot)` — GitHub default branch via `gh repo view`, falling back to `main` when unavailable; same resolver plan/intent publication already uses — rules out inventing a separate default-branch resolver.
- Remote presence uses `branchExistsOnOriginAsync(projectRoot, requestedBaseRef)` (`git ls-remote --heads origin <branch>`); empty or errored `ls-remote` is absent (fail-closed retarget even when the branch still exists locally) — rules out `rev-parse origin/<branch>` alone.
- Resolve `effectiveBaseRef` once at publication start: when `branchExistsOnOriginAsync` reports the requested `baseRef` absent, `effectiveBaseRef = getBaseBranch(worktree project root)`; otherwise `effectiveBaseRef = requestedBaseRef` — rules out retargeting only at `gh pr create` while body refresh, confirm/view base checks, and summary derivation still target the absent ref.
- `effectiveBaseRef` flows through the entire implement-stage publication attempt: `findOrCreatePr` / `confirmPr`, `refreshPrBody`, and `deriveSpecRunBodySummary` (when `specTemplate`) — rules out partial retarget.
- Chained implement `baseRef` from `pipeline-stage-resolve.ts` (`prior.branch`) remains the requested base; durable entry-run / stage-resolution base fields are not rewritten — retarget is publication-time only — rules out rewriting resolution output when the plan branch still exists locally.
- Retarget metadata contract: extend `PipelineStageArtifact` with optional string fields `requestedBase` and `resolvedBase`, present when `effectiveBaseRef !== requestedBaseRef`. On successful publication after retarget, both fields land on the stage `artifact` alongside existing artifact fields. When publication still fails after retarget, both fields land on the stage `failureDetail` alongside composed operator-error fields — rules out silent retarget with no operator-visible record.
- When the requested base exists on `origin`, `effectiveBaseRef` stays the requested ref and artifact/failureDetail omit `requestedBase` / `resolvedBase` — rules out unconditional retarget to repository base.
- Out of scope: stacked-PR merge-order policy prose (subspec 02 docs), settlement liveness, stage operator-error mirroring beyond retarget recording.

## Task checklist

- Before the PR chain, resolve `effectiveBaseRef` from `branchExistsOnOriginAsync(projectRoot, input.baseRef)` and `getBaseBranch` when absent; thread `effectiveBaseRef` through `findOrCreatePr`, `confirmPr`, `refreshPrBody`, and `deriveSpecRunBodySummary`.
- Thread retarget metadata through to stage settlement so succeeded artifacts (when retargeted) or failure details (when publication still fails after retarget) include `requestedBase` and `resolvedBase`.
- Add `completion-publisher.test.ts` — `"retargets PR base to repository base when requested base ref is absent from remote"`: assert `gh pr create`, confirm/view base checks, and body-refresh `base` use the resolved repository base; pin `// @mutate v2/src/execution/completion-publisher.ts "if (!await branchExistsOnOriginAsync" -> "if (false && !await branchExistsOnOriginAsync"` on the base-existence check before resolving `effectiveBaseRef`.
- Add `completion-publisher.test.ts` — `"preserves requested base when branch exists on origin"`: when `branchExistsOnOriginAsync` is true, `gh pr create` `--base` and downstream publication steps stay on the requested ref; artifact omits retarget fields.
- Assert retarget metadata on the stage artifact or `failureDetail` names both `requestedBase` and `resolvedBase` when retarget occurred.

## Acceptance criteria

- [ ] `completion-publisher.test.ts` — `"retargets PR base to repository base when requested base ref is absent from remote"` fails against the baseline publication chain (uses absent requested base through create/confirm/body refresh) and asserts the resolved base.
- [ ] The retarget is recorded on the stage artifact when publication succeeds after retarget, or on `failureDetail` when publication still fails, with `requestedBase` and `resolvedBase` string fields naming both bases.
- [ ] `completion-publisher.test.ts` — `"preserves requested base when branch exists on origin"` stays green (requested `--base` unchanged; no retarget metadata on artifact).
- [ ] `completion-publisher.test.ts` — `"retargets PR base to repository base when requested base ref is absent from remote"`: `// @mutate` removing the base-existence check turns the pinning regression RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Pipeline start: implement stacks on the plan stage branch; what happens when that branch merges first; retarget to repository base when the requested base is absent from `origin`; `ls-remote` failure or empty result treats the base as absent and may retarget even when the branch still exists locally.
- `v2/docs/daemon-host.md` — chained implement publication `effectiveBaseRef` retarget through the full publication chain; stage artifact / `failureDetail` `requestedBase` / `resolvedBase` recording.
- `v2/docs/v1-behaviors.md` — base-retarget behavior for pipeline implement stage rows.
