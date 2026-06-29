# First-push upstream on mark-ready finalize

## Problem

`pushWorktreeOrFail` (`v1/src/commands/triage.ts`) always calls `pushCurrent({ firstPush: false })`. When `--mark-ready` finalizes a complete-but-dirty worktree whose branch has `origin` but no upstream tracking, the finalize commit is created locally then push fails — operator must hand-run `git push --set-upstream`.

## Decisions

- Fix `pushWorktreeOrFail` in the existing `--mark-ready` finalize path — rules out a new standalone push-upstream command.
- `firstPush: !hasUpstream(worktreePath)` via `pushCurrent` — rules out always calling plain `git push`.
- Reuse `hasUpstream` / `pushCurrent` from `v1/src/worktree.ts` — rules out a triage-local upstream probe or push wrapper.
- Scope is pushes that already reach `pushWorktreeOrFail` (dirty finalize commit; clean tree when `computeUnpushed` > 0) — rules out rewriting `computeUnpushed` for no-upstream unpushed detection on clean trees.
- Deferred to first consumer: clean worktree, no upstream, local commits, `computeUnpushed` returns 0 — pin when a caller needs push-before-gate on that path.
- Behind-base, active-lock, incomplete-spec, and non-DRAFT PR guards unchanged — rules out bypassing those checks for no-upstream branches.
- Auth/network push failures keep stderr `failed to push finalize commit` plus git stderr — rules out a separate retry path that masks real failures as upstream-setup issues.

## Task checklist

- [ ] Import `hasUpstream` in `v1/src/commands/triage.ts`; set `firstPush: !hasUpstream(worktreePath)` in `pushWorktreeOrFail`.
- [ ] Add `v1/test/triage-command.test.ts` coverage: complete dirty worktree, `origin` present, branch without upstream — finalize push uses `-u`, then opens draft PR (if absent), gates, and promotes on green.
- [ ] Add test: push failure after finalize commit still exits non-zero with `failed to push finalize commit`, no PR open, no gate (commit intact).
- [ ] Update docs (below).

## Acceptance criteria

- [ ] `jarvis1 triage <worktree> --mark-ready` on a complete worktree with uncommitted changes, remote `origin`, and no upstream tracking commits the dirty work, pushes with upstream setup (`git push -u origin <branch>`), opens a draft PR when absent, runs the ready gate once, and promotes on green (exit 0).
- [ ] When the finalize push reaches `pushWorktreeOrFail` on a clean worktree with unpushed commits and no upstream, push uses upstream setup and the ready-promotion flow continues.
- [ ] A push failure after the finalize commit exits non-zero with `failed to push finalize commit` and git stderr, opens no PR, runs no gate, and leaves the commit intact.
- [ ] `v1/test/triage-command.test.ts` behind-base refusal tests (`--mark-ready refuses when behind base with open PR`, `--mark-ready refuses when behind base with no PR`) stay green.
- [ ] `v1/test/triage-command.test.ts` `--mark-ready with locked worktree returns error` stays green.

## Documentation updates

- `v2/docs/v1-behaviors.md` — `--mark-ready` finalize push sets upstream when absent (required: changes existing v1 behavior).
- `v1/docs/operator-runbook.md` — complete-but-dirty recovery: no manual `git push --set-upstream` stopgap once mark-ready handles first push.
