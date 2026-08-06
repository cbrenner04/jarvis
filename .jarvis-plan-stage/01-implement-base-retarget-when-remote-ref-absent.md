# Implement base retarget when remote ref is absent

## Problem

A `full-review` implement stage opens its draft PR with `--base <plan stage branch>`. Merging the plan PR deletes that base ref on `origin`; `gh pr create` fails, the entry run reports `completion_commit_failed` / `resume`, and the pipeline dies even though publication could succeed against the repository default branch.

## Surface

Primary: `v2/src/execution/completion-publisher.ts`. In-scope: `completion-publisher.test.ts`, `shared/git.ts` (`branchExistsOnOriginAsync`, `getBaseBranch`) as existing helpers, settlement/artifact wiring needed to persist retarget metadata on the stage row (`pipeline-stage-dispatch.ts` artifact/failureDetail fields only as needed).

## Prerequisites

- Subspec 00 landed: settlement liveness and deferred detail.

## Decisions

- **Repository base** means `getBaseBranch(projectRoot)` — GitHub default branch via `gh repo view`, falling back to `main` when unavailable; same resolver plan/intent publication already uses — rules out inventing a separate default-branch resolver.
- Remote presence uses `branchExistsOnOriginAsync(projectRoot, requestedBaseRef)` (`git ls-remote --heads origin <branch>`); empty or errored `ls-remote` is absent — rules out `rev-parse origin/<branch>` alone.
- When the configured base ref is absent from `origin`, publication retargets to the repository base for `gh pr create` (and matching PR confirm/view base checks); when the requested base exists on `origin`, it is used unchanged — rules out unconditional retarget to repository base.
- Retarget metadata is recorded on the stage artifact on success, or on `failureDetail` when publication still fails after retarget, naming both `requestedBase` and `resolvedBase` — rules out silent retarget with no operator-visible record.
- Chained implement `baseRef` from `pipeline-stage-resolve.ts` (`prior.branch`) remains the requested base; retarget happens at publication time, not stage resolution — rules out rewriting resolution output when the plan branch still exists locally.
- Out of scope: stacked-PR merge-order policy prose (subspec 02 docs), settlement liveness, stage operator-error mirroring beyond retarget recording.

## Task checklist

- Before `gh pr create`, when `branchExistsOnOriginAsync` reports the requested `baseRef` absent, resolve `resolvedBase` via `getBaseBranch(worktree project root)` and publish against `resolvedBase`.
- Thread retarget metadata through to stage settlement so succeeded artifacts (or failure details when publication still fails) include `requestedBase` and `resolvedBase`.
- Add `completion-publisher.test.ts` — `"retargets PR base to repository base when requested base ref is absent from remote"`: assert `gh pr create` uses the resolved repository base, not the absent requested base; pin `// @mutate` on the base-existence check so removing it turns the regression RED.
- Add preservation coverage: when `branchExistsOnOriginAsync` is true for the requested base, `gh pr create` `--base` stays the requested ref.
- Assert retarget metadata on the stage artifact or `failureDetail` names both requested and resolved bases.

## Acceptance criteria

- [ ] `completion-publisher.test.ts` — `"retargets PR base to repository base when requested base ref is absent from remote"` fails against the baseline `gh pr create` invocation and asserts the resolved base.
- [ ] The retarget is recorded on the stage artifact (or its `failureDetail` when publication still fails), naming both the requested and resolved base.
- [ ] A base ref that exists on `origin` is still used unchanged — no unconditional retarget to the repository base.
- [ ] `completion-publisher.test.ts` — `"retargets PR base to repository base when requested base ref is absent from remote"`: `// @mutate` removing the base-existence check turns the pinning regression RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Pipeline start: implement stacks on the plan stage branch; what happens when that branch merges first; retarget to repository base when the requested base is absent from `origin`.
- `v2/docs/daemon-host.md` — chained implement publication base retarget and stage artifact/failureDetail recording.
- `v2/docs/v1-behaviors.md` — base-retarget behavior for pipeline implement stage rows.
