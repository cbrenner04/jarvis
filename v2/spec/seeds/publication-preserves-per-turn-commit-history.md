---
name: publication-preserves-per-turn-commit-history
---

# Every workflow preserves one distinct commit per turn; the only squash is the merge to main

## Problem

v2 workflow publication destroys per-turn commit history. This is a hard regression from v1, which committed **once per turn, each commit unique to that turn's work**. Operator directive (2026-08-31), authoritative and repeated: *"I want a commit for every turn. subspec 0, subspec 1, subspec 2, and the review actuator. … the only thing that should be a squash EVER is to the main branch. EVER."* Applies to **intent, plan, and implement** workflows alike.

Two distinct collapse behaviors, both wrong:

1. **Implement collapses to ONE commit off base.** The published branch is a single commit whose tip is CAS-replaced at each terminal boundary (`write` → optional `~shrink` → `review`/`review-debate`), even though the write loop already made per-iteration commits (`commitSettledIteration` / `iteration_commit`). All per-subspec/per-turn history is erased; the surviving commit is stamped only with the terminal boundary step.
2. **Plan (and intent) keep multiple commits but with generic/duplicate messages.** The operator: *"the plan PR has multiple commits. they are useless since they say the same thing but that are distinct."* Per-turn commits survive but every subject is the same boilerplate, so they carry no per-turn information.

PR #3234 (`published-branch-write-stage-attribution`) doubled down on the single-commit model — its decision ledger explicitly chose to *"Keep the single-commit-off-base publish shape … rules out multi-commit branch history."* **This seed reverses that decision by operator directive.** #3234's trailer-attribution work is subsumed: per-turn commits are each attributed to the agent that ran that turn, so a single carried-forward trailer is no longer the mechanism.

## Evidence

- `cbrenner04/chess-mvp-yolo-2` PR #3 (pipeline implement, 3+ subspecs): published as ONE commit `review(1): iOS project and build toolchain`, `Jarvis-Agent: cursor`, `Jarvis-Step: review 1`. Should be one commit per subspec write turn (subspec 0/1/2) plus a distinct review-actuator commit — 4 commits, each with its own subject and stage/agent.
- Plan PRs across sessions: N per-turn commits with identical boilerplate subjects.
- v1 is the target model: `v1/docs/worktrees-and-commits.md`; v1's write loop commits once per turn with a message describing that turn's work.

## Desired contract (authoritative)

- **One distinct commit per turn, preserved on the branch, for every workflow (intent, plan, implement).** A "turn" is each write/split iteration that produced changes, plus the review actuator's edits, plus the shrink pass's edits when it changes anything — each is its own commit.
- **Each commit's subject is unique to its turn's actual work** — never a repeated generic boilerplate subject across turns. (Plan/intent turns must produce descriptive per-turn subjects, not the same line N times.)
- **Each commit is attributed to the agent that ran that turn** (`Jarvis-Agent`) and stamped with that turn's stage (`Jarvis-Step`: e.g. `write`, `review-debate n`, `shrink`).
- **No publication boundary rewrites, amends, resets, or collapses prior commits.** The branch's commit count only grows across write → shrink → review; no CAS-replace-to-single-commit-off-base at any terminal boundary.
- **The ONLY squash is the final merge to `main`** — the PR squash-merge, performed at merge time (by the operator / `gh pr merge --squash`). The branch and PR retain full per-turn history until then.
- **Implement and plan PRs target `main`** — standalone and **pipeline** implement/plan stages alike. Pipeline implement stages do **not** stack on the plan branch. (The stacked-PR base-pinning behavior is retired; the operator does not want stage stacking.)
- The PR body attribution footer lists the per-turn commits and their agents (its `## Commits` block becomes genuinely informative), rather than a single `Written by <review-agent>` line.

## Code loci (starting points)

- `v2/src/execution/completion-commit.ts` — `preparePendingCommit` / `commit-tree -p pending.baseHead` and `forceDistinctCommit`; the completion committer stages the full worktree (`add -A`) into one commit at each terminal boundary.
- `v2/src/execution/workflow-runner.ts` — publication tail; the `forceDistinctCommit: true` call sites (≈1124, 3532, 3955, 4385, 4593) and the terminal-boundary CAS-replace that yields "one commit off base"; per-turn subject generation for write/plan/intent turns.
- `v2/src/execution/write-loop.ts` — `commitSettledIteration` / `iteration_commit` per-turn commits (already exist; must survive to publication, not be collapsed).
- Pipeline base-targeting: the stage dispatch base resolution (`prior.branch` → plan branch) in `v2/src/daemon/pipeline-execution.ts` / chained-stage resolution; retarget implement stages to `main`.
- v1 reference implementation of per-turn commits: `v1/src/…` write loop and `v1/docs/worktrees-and-commits.md`.

## Acceptance criteria (decompose across ready-intents as needed)

- [ ] A publication regression proves a multi-subspec **implement** branch retains one commit per completed subspec write turn plus a distinct review-actuator commit (≥ N+1 commits for N subspecs), each with a distinct subject and the correct `Jarvis-Agent`/`Jarvis-Step`; it fails against the current single-commit-off-base collapse.
- [ ] A regression proves **plan** and **intent** publication produces per-turn commits whose subjects are distinct (describe each turn's work), not a repeated boilerplate subject.
- [ ] A regression proves no terminal boundary (write / `~shrink` / review) rewrites, amends, or removes a prior commit — the branch commit count is monotonic non-decreasing across boundaries.
- [ ] A regression proves standalone and pipeline implement/plan PRs target `main` (pipeline implement stages do not stack on the plan branch).
- [ ] The PR body `## Commits` block lists each per-turn commit with its agent; the footer no longer credits only the review agent.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass (plus `test:shared`/`test:v1` for any touched shared/v1 surface).

## Documentation updates

- `v1/docs/worktrees-and-commits.md` — v2 now preserves per-turn commits like v1; retire the single-commit-off-base / CAS-replace description.
- `v2/docs/workflow-runner.md` — publication preserves per-turn commit history for intent/plan/implement; only the merge to main squashes; PRs target main.
- `v2/docs/v1-behaviors.md` — record v2/v1 parity on per-turn commit history; note #3234's single-commit decision is superseded.
- `v2/docs/pipeline-execution.md` / `v2/docs/operator-runbook.md` — pipeline implement/plan stages target main (no stacking); update the stacked-PR / merge-first-hazard guidance.

## Supersedes

- #3234 (`published-branch-write-stage-attribution`) single-commit-off-base decision and its trailer-carry-forward attribution mechanism.
- The stacked-PR base-pinning behavior for pipeline stages (`merge-pipeline-stage-pr-at-its-approval-gate` friction dissolves once stages target main).
