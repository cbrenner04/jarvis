---
name: pipeline-implement-stage-cannot-clear-base-behind-origin
---

# A pipeline implement stage fails admission when the operator merges anything, and cannot pass the flag its own error names

## Problem

`implement` preflight refuses admission when the resolved base branch is strictly behind its upstream ([#3673](https://github.com/cbrenner04/jarvis/pull/3673)):

```text
base_behind_origin: main is at efcb7eadb377, origin/main is at 91995f6663ea; run git pull or pass --base origin/main
```

That guard is right for a standalone `jarvis run workflow implement`, where the operator owns the invocation and can pass `--base origin/main`. **A pipeline implement stage has neither lever.** Its base comes from pipeline admission context, not an operator-supplied flag, so of the two remedies the message names, one does not exist for this caller.

The trigger is ordinary operator behaviour, not misuse: any merge to `origin/main` while a pipeline is live leaves the local checkout behind, and every implement stage that reaches admission afterwards fails. Merging is the documented way to land a pipeline's own earlier stage PRs, so the pipeline manufactures its own failure condition.

## Evidence (2026-09-09)

Pipeline `2ec1fa09` (`full-review`, seed `implement-publishes-its-review-verdict-into-the-spec-tree`). Its plan stage landed [#3684](https://github.com/cbrenner04/jarvis/pull/3684); the operator merged an unrelated spec PR ([#3680](https://github.com/cbrenner04/jarvis/pull/3680)) in the same window; the `approve-plan` gate was then approved and the implement stage settled `failed` immediately with the message above, `workflowInvocationId: null` — no run row, no worktree, no agent invocation.

Recovery was `git pull --ff-only origin main` in the operator checkout followed by `jarvis pipeline resume 2ec1fa09 completion-commit-never-stages-review-verdicts`, which dispatched normally. So the stage is recoverable, but only by an operator who is watching and who knows the pipeline's base is the primary checkout's local branch rather than the pipeline's own admission ref.

## Decisions

- A pipeline implement stage resolves a base that is behind its upstream by using the fetched remote ref, rather than refusing; rules out requiring an operator flag on a caller that has no flag surface.
- The refusal is retained for callers that *can* act on it (standalone `implement` with an explicit `--base`); rules out deleting the guard, whose original purpose — refusing to branch from a stale base and re-implement merged work — is unchanged.
- The stage failure, if one is still reachable, names `pipeline resume` as its recovery rather than `--base origin/main`; rules out an error whose only stated remedies are unavailable to the caller that received it.

## Acceptance criteria

- [ ] A test proves a pipeline implement stage whose resolved base is strictly behind its upstream admits and dispatches against the fetched remote head, rather than settling `failed`; it fails against the current unconditional refusal.
- [ ] A test proves a standalone `jarvis run workflow implement --base main` with a base behind its upstream still refuses with `base_behind_origin` (guard retained for the caller that can act on it).
- [ ] A test proves the pipeline-stage path does not consult or mutate the operator's primary checkout to satisfy the freshness requirement.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — under **Pipeline start**, state how a chained implement stage resolves its base and that merging during a live pipeline no longer strands it.
- `v2/docs/pipeline-execution.md` — record base resolution for chained implement stages.
