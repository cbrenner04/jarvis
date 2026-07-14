# 01 - Lock check honors the v2 lock root

`triage --merge`'s busy-worktree guard reads `<worktree>/.jarvis.lock` (`getWorktreeLockPath`, `v1/src/commands/triage.ts`).
v2 runs hold their lock outside the worktree, at `~/.jarvis/worktree-locks/<project-key>/<branch>/.jarvis.lock`
(`v2/src/execution/external-worktree.ts`), so a v2 worktree resolved by subspec 00 looks unlocked and `--merge`
could run the ready gate and merge under a live v2 run.

## Decisions

- For a worktree resolved from the v2 home, the lock check reads the v2 lock root; v1-home worktrees keep the
  in-worktree lock path. Rules out checking only one location for both.
- Stale-lock semantics (`isProcessAlive`) are unchanged — rules out re-deriving liveness rules for v2.

## Acceptance criteria

- [ ] `jarvis1 triage <target> --merge` on a v2-home worktree whose live lock is held under `~/.jarvis/worktree-locks/<project>/<branch>/.jarvis.lock` refuses (non-zero, no ready gate, no merge) naming the holding pid.
- [ ] The same v2 worktree with a stale (dead-pid) lock merges normally.
- [ ] v1-home lock behavior is unchanged: existing `triage-command.test.ts` lock tests stay green.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record that `--merge`'s lock check follows the resolved worktree's home.
