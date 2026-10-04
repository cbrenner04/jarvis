# A chained pipeline implement stage cannot tick its own acceptance criteria

## Problem

A chained implement stage reads its spec tree from the **prior stage's** worktree (`specReadRoot`, the plan-stage worktree) while the agent writes code in the **implement** worktree, which is branched from the repository default branch. The plan stage's spec tree exists only on the plan branch, which has not merged, so the spec directory **is not present in the implement worktree at all**.

Completion is gated on ticked acceptance criteria, and the spec.criteria-ticked contract re-reads the subspec *from the run's worktree*. So the read root and the completion contract disagree about where the spec lives, and the agent — confined to its own worktree — can neither tick a criterion nor append a `## Blocker` to the file the harness will check.

Every chained pipeline implement stage is therefore structurally unable to complete honestly: it can do the work, and cannot record that it did.

## Evidence (2026-09-09, two lanes, independently)

Both lanes of two different `full-review` pipelines, same session, same shape.

**Lane 1** — pipeline `2ec1fa09`, spec `20260909T151221Z-completion-commit-never-stages-review-verdicts`, run `51838502`. Settled `missing_blocker` / `paused` / `resumable: true` after 3 iterations. The `missing_blocker_detail` record carries the agent's own accurate diagnosis:

> I need explicit approval to switch this session's working directory into the plan worktree … so I can write to the spec file that lives only there — it hasn't merged to `main` yet, so it doesn't exist in this implement worktree, and the sandbox blocks writes outside my current worktree.

The agent had already **committed correct work** (`3fd736cce`, 6 files: `completion-commit.ts`, 81 lines of new `completion-commit.test.ts`, `.gitignore`, three docs). Its own commit message names the spec at the plan worktree's absolute path — direct evidence that `specReadRoot` points outside the implement worktree:

```text
Spec: /Users/…/.jarvis/worktrees/jarvis/plan/completion-commit-never-stages-review-verdicts/v2/spec/20260909T151221Z-…/00-exclude-review-verdicts.md
```

**Lane 2** — pipeline `0dae0425`, spec `20260909T151617Z-pipeline-daemon-resolution-across-live-sockets`, run `88c144e4`. Same absent spec directory in its implement worktree; work in progress on five files.

Verified directly: `ls <implement-worktree>/v2/spec/` lists the seeds, ready-intents and `completed/` trees plus an unrelated spec, and **not** the spec directory the stage is implementing.

**Lane 3 — the sharper proof (same session).** Pipeline `83ef0bc2`, spec `20260909T151221Z-await-process-group-termination-before-settlement`, run `a6720fc7`. Here the operator had already merged the plan PR, so the implement worktree *did* contain the spec directory. The agent implemented the work, committed it, and **ticked all 15 acceptance criteria**. The run still settled `contract_miss` naming all 15 as unticked.

Measured directly:

| Copy | Ticked | Unticked |
| --- | --- | --- |
| implement worktree (agent wrote here) | 15 | 0 |
| plan worktree (`specReadRoot`, contract read here) | 0 | 15 |

So the defect is not merely "the spec directory is missing". It is that **`specReadRoot` is authoritative for the completion check while the agent writes in the implement worktree**, and the two copies diverge the moment the agent ticks anything. Missing-directory is only the shape this takes when the plan PR has not merged yet.

**Three settlement shapes, one cause.** `missing_blocker` (agent cannot write the spec at all), `gate_invocation_refused` (unrelated refusal masking the same lane), and `contract_miss` (agent ticked the copy nobody reads). None names the divergence, so each looks like a different bug.

## Decisions

- The chained implement stage materializes its spec tree into the implement worktree before the write step, so the read root, the agent's writable root, and the criteria-ticked contract all resolve to one location; rules out an agent that must write outside its confinement to record progress.
- Publication continues to land the spec tree onto the implement branch as it does today; rules out a second, divergent publication path.
- The criteria-ticked contract keeps reading from the run's worktree; rules out relaxing the completion gate to read a different tree than the one it publishes, which would let a run report ticked criteria it never wrote.
- A stage that still cannot resolve its spec tree fails at admission naming the absent path, rather than dispatching an agent that cannot succeed; rules out spending a full iteration budget to discover a missing file.

## Acceptance criteria

- [x] A test proves a chained implement stage's write step runs against a worktree that contains the spec directory named by its `specPath`; it fails against the current prior-worktree-only read root.
- [x] A test proves an acceptance criterion ticked by the agent during a chained implement stage is read back by the criteria-ticked completion contract from the same worktree; it fails against the current split where the agent writes the implement worktree and the contract reads the plan worktree.
- [x] A test proves a chained implement stage whose spec tree cannot be materialized fails at admission naming the unresolved path, with no run row and no agent invocation.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — record where a chained implement stage's spec tree lives and when it is materialized.
- `v2/docs/operator-runbook.md` — under **Pipeline start**, correct the chained-stage description of `specReadRoot` and index-tick publication.
- `v2/docs/v1-behaviors.md` — record the corrected v2 behavior.
