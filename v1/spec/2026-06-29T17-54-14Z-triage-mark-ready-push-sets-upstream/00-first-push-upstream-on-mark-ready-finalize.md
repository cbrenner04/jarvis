# First-push upstream on mark-ready finalize

## Problem

`pushWorktreeOrFail` (`v1/src/commands/triage.ts`) always calls `pushCurrent({ firstPush: false })`. When `--mark-ready` finalizes a complete-but-dirty worktree whose branch has `origin` but no upstream tracking, the finalize commit is created locally then push fails — operator must hand-run `git push --set-upstream`.

In scope: paths that already reach `pushWorktreeOrFail` (dirty finalize commit; clean tree only when `computeUnpushed` > 0). Out of scope here: clean worktree, no upstream, local commits, `computeUnpushed` returns 0 — see deferral below.

## Decisions

- Fix `pushWorktreeOrFail` in the existing `--mark-ready` finalize path — rules out a new standalone push-upstream command.
- `firstPush: !hasUpstream(worktreePath)` via `pushCurrent` — rules out always calling plain `git push`.
- Reuse `hasUpstream` / `pushCurrent` from `v1/src/worktree.ts` — rules out a triage-local upstream probe or push wrapper.
- Scope is pushes that already reach `pushWorktreeOrFail` (dirty finalize commit; clean tree when `computeUnpushed` > 0) — rules out rewriting `computeUnpushed` for no-upstream unpushed detection on clean trees.
- Deferred to first consumer: clean worktree, no upstream, local commits, `computeUnpushed` returns 0 — pin when a caller needs push-before-gate on that path.
- Behind-base, active-lock, incomplete-spec, and non-DRAFT PR guards unchanged — rules out bypassing those checks for no-upstream branches.
- Auth/network push failures keep stderr `failed to push finalize commit` plus git stderr — rules out a separate retry path that masks real failures as upstream-setup issues.
- Add triage `pushCurrent` seam on `pushWorktreeOrFail` when needed to pin `firstPush` — rules out relying on `setupMarkReadyWorktree` (always sets upstream) as proof of `-u`.

## Task checklist

- [ ] Import `hasUpstream` in `v1/src/commands/triage.ts`; set `firstPush: !hasUpstream(worktreePath)` in `pushWorktreeOrFail`; wire optional `pushCurrent` seam through `TriageCommandOptions` when tests cannot observe argv otherwise.
- [ ] Add no-upstream fixture in `v1/test/triage-command.test.ts`: `origin` present, upstream unset (dedicated helper or equivalent unset-upstream steps after local-only commits), complete dirty worktree.
- [ ] Add test on that fixture: real finalize commit and push; assert `pushCurrent` received `firstPush: true` (seam capture) or `@{u}` is `origin/<branch>` after success; then opens draft PR when absent, gates, and promotes on green.
- [ ] Replace `--mark-ready push failure after finalize commit skips PR open and gate`: dirty worktree, real finalize commit via default path, inject push failure on `pushWorktreeOrFail` only; assert exit non-zero with `failed to push finalize commit` and git stderr, no PR open, no gate, finalize commit still at HEAD.
- [ ] Update docs (below).

## Acceptance criteria

- [ ] `jarvis1 triage <worktree> --mark-ready` on a complete dirty worktree with remote `origin` and no upstream tracking commits the dirty work, push succeeds, opens a draft PR when absent, runs the ready gate once, and promotes on green (exit 0).
- [ ] When finalize push runs on a no-upstream worktree, `pushCurrent` receives `firstPush: true` — verified by triage seam capture or post-success `@{u}` equals `origin/<branch>`.
- [ ] A push failure after a real finalize commit on the `pushWorktreeOrFail` path exits non-zero with `failed to push finalize commit` and git stderr, opens no PR, runs no gate, and leaves the finalize commit at HEAD.
- [ ] `v1/test/triage-command.test.ts` behind-base refusal tests (`--mark-ready refuses when behind base with open PR`, `--mark-ready refuses when behind base with no PR`) stay green.
- [ ] `v1/test/triage-command.test.ts` `--mark-ready with locked worktree returns error` stays green.

## Documentation updates

- `v2/docs/v1-behaviors.md` — `--mark-ready` finalize push sets upstream when absent on paths that reach `pushWorktreeOrFail` (required: changes existing v1 behavior).
- `v1/docs/operator-runbook.md` — complete-but-dirty recovery: no manual `git push --set-upstream` stopgap once mark-ready handles first push on the dirty-finalize path.
