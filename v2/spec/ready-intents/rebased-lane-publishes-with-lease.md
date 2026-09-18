---
name: rebased-lane-publishes-with-lease
---

# A continued lane that was rebased publishes with a lease-forced push

Unsplit rationale: the fix is one publication-push behavior in the completion publisher, self-contained — it resolves the rebased condition locally rather than threading an admission-time signal in — well under one reviewable PR.

## Primary implementation surface

- `v2/src/execution/completion-publisher.ts`

## Problem

`#4014` rebases a non-descendant lane on incomplete re-dispatch, rewriting its SHAs. `completion-publisher.ts:136` pushes `HEAD:refs/heads/<branch>` without a lease, so an already-pushed lane (open-PR case) is rejected non-fast-forward; `publication-retry.ts:45` classifies that permanent. The run spends a full implement then dies at publication with commits only local. No test covers push-after-rebase

## Decisions

- Immediately before pushing, the publisher resolves the remote's current tip of `refs/heads/<branch>` (`git ls-remote origin`). If a tip exists and is not an ancestor of local `HEAD`, it pushes with `--force-with-lease=refs/heads/<branch>:<observed tip>`; this determines the rebased case locally, from git state, rather than requiring an admission-time flag to be threaded through the run — rules out both a blanket force push and a lane that can never publish after a rebase.
- A lease rejection stays a permanent publication failure naming the branch and expected-versus-actual remote SHA; never escalates to `--force`.
- A lane with no remote tip, or whose remote tip is an ancestor of local `HEAD` (the ordinary, non-rebased case), keeps the current non-force push unchanged.

## Acceptance criteria

- [ ] A `completion-publisher` test proves a rebased lane whose branch was already pushed publishes successfully with a lease against the tip the run observed; it fails against the current unconditional non-force push.
- [ ] A test proves a non-rebased lane still pushes without any force flag.
- [ ] A test proves a lease rejection settles a permanent publication failure naming the branch and expected-versus-actual remote SHA, with no retry and no `--force` escalation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — lease-forced publication push for a rebased continued lane and its rejection shape.
- `v2/docs/operator-runbook.md` — what a lease rejection means and why re-running is not the recovery.
- `v2/docs/v1-behaviors.md` — publication push behavior for rebased lanes.

## Prerequisites

- None — the publisher determines the rebased condition locally from git ancestry at push time (`git ls-remote` plus a local ancestry check), so no admission-time "this run rebased" signal needs to already exist or be threaded in from the caller.
