---
name: standalone-plan-redispatch-retires-a-never-landed-lane
---

# Standalone `plan` re-dispatch refuses a never-landed lane that pipeline resume would retire

## Problem

`jarvis run workflow plan --ready-intent <path>` refuses re-dispatch when the managed plan worktree's `HEAD` is not a descendant of the resolved base: `Cannot re-run incomplete spec: worktree HEAD <sha> is not a descendant of base main (<sha>); stale reuse refused`. The descendant gate is gate (1) of the incomplete-re-run preflight and **no flag overrides it**, so the only move is `jarvis cleanup --yes --abandon plan/<name>` followed by re-issuing the identical command.

Failed **pipeline** plan resume already does this automatically. It classifies a lane as disposable when the branch has a confirmed-absent open PR and no commits ahead of base outside harness workflow staging, then retires and rematerializes from base without flags — explicitly "even when its `HEAD` is not descended from base" ([`operator-runbook.md` § Pipeline resume](../../docs/operator-runbook.md#pipeline-resume)). Standalone plan re-dispatch shares `resetStaleWorkspace` but not that classification, so the same never-landed lane is refused on one path and retired on the other.

Every occurrence has the same shape and the same fix, which is why it is pure toil: a plan worktree materialized before a merge is pinned at the old `main`, and any merge (including the pipeline's own stage PRs) strands it. Recorded as unseeded friction on 2026-09-07 after **six** occurrences in one session ("implement auto-resets this, plan does not"); recurred 2026-09-10 on `plan/mutation-survivor-confirmed-by-isolated-rerun`, whose failed pipeline lane had never pushed a branch or opened a PR.

## Decisions

- Standalone `plan` re-dispatch applies the same never-landed disposable-lane classification as failed pipeline plan resume, and retires plus rematerializes from base rather than refusing the descendant gate; rules out a second, divergent staleness policy for the same worktree.
- Classification stays fail-closed on an inconclusive open-PR probe (the sandboxed-`gh` default) and on any commit ahead of base touching a path outside harness workflow staging — the existing landed-work guards are reused verbatim, not re-derived; rules out re-dispatch destroying a lane that pushed real work.
- A retirement taken on this path prints the same worktree-disposition line the pipeline path prints, so the operator sees the lane was discarded rather than reused.
- Not in scope: the descendant gate itself, or `implement`, which already resets on its own base.

## Acceptance criteria

- [ ] A test proves standalone `plan` re-dispatch over a never-landed plan worktree whose `HEAD` is not a descendant of base retires and rematerializes it, then dispatches; it fails against the current `stale reuse refused` refusal.
- [ ] A test proves a plan lane with a commit ahead of base changing a path outside harness workflow staging is still refused, with the worktree and commit intact.
- [ ] A test proves an inconclusive open-PR probe refuses before any retirement, preserving the worktree.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the standalone plan re-dispatch path retires a never-landed lane; drop the `cleanup --abandon` step for that case.
- `v2/docs/workflow-runner.md` — record the shared classification between standalone plan re-dispatch and pipeline plan resume.
