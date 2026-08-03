---
name: implement-rerun-completes-over-a-stale-dirty-worktree
---

# An implement re-run executes in a stale dirty worktree and settles `completed` having committed nothing

## Problem

Observed 2026-08-03, run `eabc39a7` on `20260803T013930Z-tui-command-dispatch`, launched as
`jarvis run workflow implement --base main --spec …/index.md --detach`.

Telemetry `worktree_path` names the **pre-existing** managed worktree. Its HEAD sat at merge-base
`7d52a401b`, three commits behind the resolved `--base` (`bd7d9068b`), and it carried four modified
tracked paths at launch, left by an earlier `iteration_timeout` run:

```text
 M v2/spec/20260803T013930Z-tui-command-dispatch/02-status-row-projection.md
 M v2/spec/20260803T013930Z-tui-command-dispatch/index.md
 M v2/src/tui/tui-monitor-lines.test.ts
 M v2/src/tui/tui-monitor-lines.ts
```

`resetStaleWorkspace` neither retired it nor refused. Two consequences:

1. The write step read the subspec **from the dirty worktree**, where the previous run had already
   ticked all four acceptance criteria, so it found nothing to do:

   ```text
   iteration_commit    skipReason: "no_file_changes"
   boundary_committed  outcomeKind: "no-work"  runStatus: "completed"
   loop_finished       complete, iterationsConsumed: 1, resumable: false
   ```

   Nothing was committed, pushed, published, or gated — but the row reads `completed`, which the
   runbook contract says implies a completion commit, PR evidence, and a green gate. An operator
   polling `run list` sees success. The subspec's real work sat uncommitted on disk and had to be
   salvaged by hand (PR #2575).

2. The successor review step (`639c40a6`) dispatched in the same millisecond the write step settled
   and stayed live **75+ minutes** against that debris worktree until hand-killed. Had it reached a
   completion commit, `git add -A` would have shipped a stranded `@mutate` application
   (`if (false)` in `wrapMonitorRows`) that was on disk at the time.

**Root cause is not established.** Re-running the identical command later refused at the
*live-run* gate (`Cannot re-run incomplete spec: daemon reports live run`), which precedes the
dirty gate in `resetStaleWorkspace`, so the dirty gate was never exercised in reproduction. Do not
cut a fix against a guessed cause — the first acceptance criterion is a reproduction.

## Decisions

- A reproduction lands before any fix: a test drives the implement re-run path against a managed
  worktree that is both behind `--base` and dirty, and asserts today's behavior is refused — rules
  out fixing a cause that was never demonstrated.
- An implement re-run refuses or retires when the managed worktree HEAD is not a descendant of the
  resolved `--base`, independently of dirty state — rules out silently reusing a stale branch tip
  whose spec copy disagrees with the base.
- A write step resolving `no-work` while its worktree holds uncommitted tracked changes settles a
  named non-`completed` failure listing those paths — rules out reporting success over work that
  was never committed.
- The `no-work` completeness decision reads the spec tree as it exists at the run's own base, not
  as a previous run left it — rules out inheriting another run's ticks.
- Out of scope: stranded mutation restoration (`mutation-verification-outlives-its-run`),
  `iteration_timeout` non-resumability (`iteration-timeout-discards-completed-subspecs`), and the
  review step's missing wall-clock bound.

## Acceptance criteria

- [ ] A regression drives the implement re-run preflight against a managed worktree whose HEAD is
      behind the resolved base **and** has uncommitted tracked paths, and asserts a refusal naming
      those paths; it fails against the current preflight.
- [ ] A regression asserts an implement re-run refuses when the managed worktree HEAD is not a
      descendant of the resolved `--base`, with a clean worktree, naming base and worktree HEAD.
- [ ] A regression asserts a write step that resolves `no-work` over a worktree with uncommitted
      tracked paths settles a non-`completed` status naming those paths, and that `run list` /
      `wait` project it; it fails against the current boundary.
- [ ] Mutation checkpoint: a `// @mutate` directive inverting the descendant check and a second
      inverting the dirty-`no-work` refusal each turn their pinning test RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and
      `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a `completed` implement row no longer admits the
  `no-work`-over-dirty case; state what `no-work` now settles instead.
- `v2/docs/v1-behaviors.md` — record the added v2 preflight descendant check and the dirty
  `no-work` refusal.

## Prerequisites

- `resetStaleWorkspace` and its gate order (`v2/src/commands/cleanup.ts`), reached from
  `maybeResetStaleWorkspace` (`v2/src/commands/workflow.ts`).
- The write-loop completion boundary that maps `no-work` to `runStatus: "completed"`.
