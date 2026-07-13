# v2 worktrees live outside the repo, so no gate can run inside them

A v2 workflow worktree is created at `~/.jarvis/worktrees/<project>/<branch>/` — **outside the
project repo**. Bun resolves `node_modules` by walking up from the working directory, and that
walk never reaches the repo's `node_modules`. So inside a v2 worktree:

```sh
bun run typecheck
# error: script "typecheck" exited with code 127   ← tsc not found
```

Every gate command (`typecheck`, `check`, `test`, `ready`) fails the same way. **No v2 run can
gate its own work.** The v1 harness never hit this because `.worktree/<spec>/` sits *inside* the
repo, so the up-walk finds the root `node_modules`.

## Problem

Observed 2026-07-13 while hand-recovering the `shared-invocation-claude-stream-json` run.
`bun run typecheck` in `~/.jarvis/worktrees/jarvis/20260713T221922Z-.../` exits 127; symlinking
the repo's `node_modules` into the worktree makes the same command pass immediately.

This is a strong candidate for the `ready_finalize_failed` rows carried by v2 runs in
`jarvis run list` (`intent/implement-reports-done-with-unticked-cri`,
`plan/no-done-without-a-completion-commit`, and others). It also means an agent working in a v2
worktree cannot run the tests it is told to run before ticking acceptance criteria — the
repo's own `AGENTS.md` instructs it to run `bun run typecheck` and a test script, and both are
unrunnable there. An agent that cannot verify may tick criteria on unverified work, which is the
same family as the false-`done` P0.

## Decisions

- **A v2 worktree can run the project's gate.** Whatever the mechanism (install into the
  worktree, link the project's `node_modules`, or run gates with the repo root as cwd), the
  observable is that `bun run typecheck` / `bun run ready` succeed inside a freshly created v2
  worktree without operator help.
- **The gate's failure must not be silent.** A gate that exits 127 is a harness defect, not a red
  gate; it must surface as a named failure, not as `ready_finalize_failed` with no cause.
- Do not solve this by moving worktrees back inside the repo — the external home is a v2 design
  decision (`v2/docs/operator-runbook.md` § Worktrees and branches).

## Prerequisites

- None.

## Out of scope

- Whether the completion path *should* run a gate at all (it should; see
  `v2-ready-gate-omits-lint-and-format`).

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — until this ships, a v2 run's gate result is
  meaningless; re-gate by hand from the repo root. Delete when this ships.
