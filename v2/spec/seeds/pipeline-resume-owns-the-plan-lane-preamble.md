---
name: pipeline-resume-owns-the-plan-lane-preamble
---

# Resuming a failed plan lane is a four-step manual ritual, and most of it is provably unnecessary

## Problem

A `full-review` pipeline almost never runs seed → intent → plan → implement in one straight line. The intent stage nearly always splits, so the operator's real work is resuming individual plan lanes — repeatedly, for every pipeline. Each resume has become a memorised preamble before the one command that matters:

1. Make sure the `plan/*` branch is clean; if not, commit as WIP.
2. Make sure the branch is up to date with `main`; if not, merge `main`.
3. Make sure the blocker is removed from the staged `intent.md`; if not, remove and commit.
4. `jarvis pipeline resume <pipeline-id> <branch-key>`.

**Steps 1 and 2 are cargo cult, and step 3 is usually unnecessary.** Read against the code:

- The staged tree for a *plan* stage lives at `.jarvis-plan-stage/`, not `.jarvis-intent-stage/` (`stagedPlanOperatorBlocker`, `v2/src/daemon/pipeline-execution.ts`). Operators routinely reach for the wrong path, which is itself a sign the ritual is folklore rather than contract.
- `stagedPlanOperatorBlocker` already distinguishes the reserved harness marker `Artifact contract check failed:` from an operator-authored `## Blocker`. Only an operator-authored blocker refuses. A harness contract-miss blocker — the common case — needs no manual removal at all.
- `refuseReopenedPlanOperatorBlocker` and `failedPlanRedraftRequiresStaleReset` both engage **only when reset flags are passed** (`reopenedStageResetFlags(...) !== undefined`, `skipDirtyWorktreeGate === true`).
- When the reset does engage, `runSharedStaleResetPreflight` delegates to the same CLI stale-reset path as an incomplete re-run, which **retires the worktree, deletes the local and remote branch, prunes the tracking ref, and closes the matching draft PR** before rematerializing the lane from base.

So in the reset case a WIP commit is destroyed along with the branch, and merging `main` is moot because the lane is rematerialized from base regardless. The operator is doing careful preservation work on a tree the harness is about to delete.

The cost is not just wasted steps. The ritual teaches operators that resume is dangerous and manual, so they hesitate to use it, and lanes sit unresumed.

## Evidence

Observed 2026-09-02/03: fan-out is the norm, not the exception — of the pipelines driven this session, the intent stage split in every multi-behaviour case, and the straight-line seed → intent → plan → implement shape did not occur once. Separately, a terminal pipeline stranded a complete, correct five-subspec plan draft where `pipeline recover` refused `stage_not_recoverable` and resume refused a terminal pipeline; the draft was recoverable only by hand-copying it out of `.jarvis-plan-stage/`.

## Decisions

- **`pipeline resume` owns the preamble.** For a failed plan lane it performs the whole sequence itself: settle the worktree state, bring the lane to its base, clear reserved harness blocker sections, and dispatch. Rules out the operator hand-executing four steps before every resume.
- **State what resume does to the worktree, in one line of output.** The operator's ritual exists because the destructive-vs-preserving distinction is invisible at the call site: with reset flags the lane is retired and rematerialized from base; without them the existing tree is reused. Resume must say which path it took. Rules out preservation work on a tree about to be deleted.
- **Never silently discard operator-authored content.** An operator `## Blocker` still refuses (unchanged), and any uncommitted change that is not recognisable harness draft dirt is either preserved or named in the refusal. Rules out a convenience that eats real work.
- Do not require the operator to know the staged directory name. Every message that references it prints the resolved absolute path. Rules out `.jarvis-intent-stage/` vs `.jarvis-plan-stage/` confusion.
- Because fan-out is the norm, the branch-key argument should be discoverable from the command itself — resume with no branch key on a fan-out pipeline lists the resumable lanes rather than only refusing. Rules out a `pipeline list --json` detour to find a slug.

## Acceptance criteria

- [ ] Resuming a failed plan lane whose staged `intent.md` carries only the reserved `Artifact contract check failed:` section dispatches without any manual edit — pinned by a test.
- [ ] Resuming a failed plan lane over a dirty worktree containing only harness draft dirt dispatches without a manual commit — pinned by a test.
- [ ] An operator-authored `## Blocker` still refuses, and the refusal names the resolved absolute path of the staged file — pinned by a test asserting the path appears in the message.
- [ ] Resume reports which worktree path it took (retired-and-rematerialized vs reused) on success — pinned by a test.
- [ ] `pipeline resume <id>` with no branch key on a fan-out pipeline lists the resumable branch keys instead of refusing opaquely — pinned by a test.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Pipeline resume: delete the manual preamble; state that resume owns it, and which cases retire the lane versus reuse it.
- `v2/docs/pipeline-execution.md` — the plan-lane resume contract: reserved versus operator blocker, and the worktree disposition in each path.
