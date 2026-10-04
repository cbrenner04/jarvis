# Durability checkpoints use best-effort format and always commit

## Problem

The per-iteration durability floor (`commitSettledIteration` / `checkpointSettledIteration`) and controlled-loss checkpoint (`checkpointBeforeControlledLoss`) call the completion committer, whose scoped pre-stage pass runs fail-closed `bun biome check --write` and throws on non-autofixable lint (commonly `noExcessiveCognitiveComplexity`). A lint failure at that seam settles `iteration_commit_failed` and strands agent edits precisely when a checkpoint matters most; `unsupported_resume_context` projection from other `iteration_commit_failed` causes remains out of scope. Controlled-loss quiescence inherits the same gate.

## Sibling sequencing

Cross-link `v2/spec/seeds/implement-biome-complexity-commit-strand-is-resumable.md` when either lands. That seed targets reprompt/resumability for complexity at the commit boundary; this spec decouples durability checkpoints from lint gating only.

## Prerequisites

- `preparePendingCommit` runs scoped `bun biome check --write` on enumerated changed paths before `git add -A` for every committer invocation today (`v2/src/execution/completion-commit.ts`).
- Every settled git-backed write-loop iteration, reprompt progress boundary, and controlled-loss quiescence with a real step result checkpoints through `checkpointSettledIteration` before its SQLite or loss boundary (`v2/docs/write-behavior.md`).

## Decision ledger

- Durability checkpoints run scoped `bun biome format --write` best-effort on enumerated changed paths, then commit when the worktree has file changes; structural skip reasons (`no_git`, `no_binding`, `no_file_changes`) are unchanged — "commit on file changes" means not gated by lint/format failure when changes exist; rules out `biome check` linter failures gating the per-turn floor.
- A checkpoint format-tool non-zero exit or timeout is logged or swallowed best-effort and never prevents commit or settles `iteration_commit_failed` for that reason alone; complexity lint is the pinned regression — format-tool swallowing is best-effort defensive behavior only; rules out fail-closed checkpoint formatting inherited from terminal completion.
- Terminal completion commits, ready-gate repair re-commits, and other `forceDistinctCommit` publication-boundary calls keep fail-closed scoped `bun biome check --write` via a separate formatter path from checkpoint best-effort formatting; rules out weakening completion hygiene or silently dropping lint enforcement at the completion boundary.
- `jarvis-completion-pending.json` records which format mode prepared the tree (`checkpoint` vs `strict`); a strict-path committer invocation that resumes pending prepared in `checkpoint` mode re-runs fail-closed `runCompletionFormat` before staging; rules out terminal completion inheriting checkpoint-only hygiene from an interrupted pending retry.
- Lint and complexity enforcement stay at the ready gate and CI; rules out weakening those gates to compensate for checkpoint decoupling.
- Scope covers every `checkpointSettledIteration` caller — per-iteration settlement, reprompt progress boundaries, and controlled-loss quiescence — not only the two named paths; rules out folding biome-ignore reprompt or helper-extraction loops from [[implement-biome-complexity-commit-strand-is-resumable]] into this change.

## Work

- Add a checkpoint-specific best-effort scoped `bun biome format --write` pre-stage in the completion committer seam (or an adjacent helper) selected for all `checkpointSettledIteration` callers; terminal and repair re-commit paths keep the existing strict `runCompletionFormat` (`biome check --write`) behavior.
- Thread the checkpoint-vs-completion format distinction through `commitSettledIteration` without changing terminal `forceDistinctCommit` call sites; persist pending format mode per the ledger contract.
- Extend `v2/src/execution/write-loop.test.ts` with Biome-enabled regressions (same class of fixture as `completion-commit.test.ts` `initRealGitWorktree`, not `initGitWorktree` markdown-only and not a mocked `completionCommitter`) that seed a complexity-dirty worktree edit, assert checkpoint commit success, and assert the run does not settle `iteration_commit_failed` for lint at the checkpoint seam.
- Add a killing regression in `write-loop.test.ts` proving the checkpoint uses best-effort formatting (swapping it to the strict completion check turns the test red).
- Keep `completion-commit.test.ts` terminal-completion regressions and existing checkpoint-failure precedence tests green.
- Update durable docs listed below.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` test `per-iteration checkpoint commits despite biome complexity lint on worktree edit` uses a Biome-enabled worktree fixture (same class as `completion-commit.test.ts` `initRealGitWorktree`), exercises production formatting through the real committer (not a mocked `completionCommitter`), drives a settled iteration whose worktree edit trips `noExcessiveCognitiveComplexity`, asserts the turn's edits are on the branch afterward, and does not settle `iteration_commit_failed`; it fails against the current `biome check --write` committer that throws on the lint error.
- [x] `v2/src/execution/write-loop.test.ts` test `checkpoint durability uses best-effort biome format not completion check` proves the checkpoint uses best-effort formatting, not the terminal completion's fail-closed check: swapping the checkpoint's format call to the strict `runCompletionFormat` path turns this test red (the lint-dirty checkpoint would then fail to commit).
- [x] `v2/src/execution/write-loop.test.ts` test `controlled-loss checkpoint commits despite biome complexity lint on quiesced edit` uses the same Biome-enabled fixture class, covers abort/kill or watchdog quiescence (one path is sufficient — both converge on `checkpointBeforeControlledLoss`), seeds a complexity-dirty worktree edit, and asserts checkpoint commit success; it fails against the current lint-gated committer.
- [x] `v2/src/execution/completion-commit.test.ts` test `formats changed files before staging so committed tree passes biome check` stays green (terminal completion and ready-gate repair re-commits keep strict formatting).
- [x] `v2/src/execution/write-loop.test.ts` test `settled checkpoint failure supersedes terminal boundary and publication` stays green (non-lint checkpoint commit failures still settle `iteration_commit_failed` and block publication).
- [x] `v2/src/execution/write-loop.test.ts` test `watchdog checkpoint failure supersedes timeout boundary` stays green (controlled-loss checkpoint commit failures still supersede timeout settlement).
- [x] `v2/docs/write-behavior.md` records that per-iteration, reprompt-progress, and controlled-loss checkpoints commit on file changes without lint/format gating, checkpoint hygiene is best-effort `biome format --write`, and lint enforcement stays at the ready gate, not a durability gate.
- [x] `v2/docs/operator-runbook.md` reconciles all three complexity-enforcement boundaries in the cognitive-complexity / biome-commit-strand gotcha (line ~425): durability checkpoints no longer strand work (best-effort format, commit on file changes); ready gate and CI still enforce complexity; terminal completion still fail-closes on uncommitted lint-dirty paths via scoped `biome check --write`.
- [x] `v2/docs/v1-behaviors.md` updates or supersedes the existing shared-committer bullet at line 535 so the parity catalog records checkpoint best-effort `biome format --write` separately from terminal/repair fail-closed scoped `biome check --write` — not an append-only addition that contradicts the old "every invocation" contract.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/write-behavior.md` — per-iteration, reprompt-progress, and controlled-loss checkpoints commit on file changes without lint/format gating; checkpoint hygiene is best-effort `biome format --write`; lint enforcement stays at the ready gate, not a durability gate; pending format-mode contract per decision ledger.
- `v2/docs/operator-runbook.md` — reconcile checkpoint, terminal completion, and ready-gate/CI complexity boundaries in the cognitive-complexity gotcha (~line 425).
- `v2/docs/v1-behaviors.md` — supersede line 535's shared-committer bullet with the checkpoint/completion format split.
