---
name: per-turn-checkpoint-commit-never-gated-by-lint
---

# Per-turn durability checkpoints commit despite lint failures

Unsplit rationale: Checkpoint commit hygiene, write-loop per-iteration and controlled-loss checkpoint wiring, and terminal completion-commit preservation are one execution-loop durability contract; splitting by file would land a committer half that still strands turns at the checkpoint seam.

## Primary implementation surface

Execution loop

## Prerequisites

## Problem

- The per-iteration durability floor (`commitSettledIteration` / `checkpointSettledIteration`) calls the completion committer, whose scoped pre-stage pass runs `bun biome check --write` and throws on non-autofixable lint (commonly `noExcessiveCognitiveComplexity`).
- A lint failure settles `iteration_commit_failed`, often projecting non-resumable `unsupported_resume_context`, stranding agent edits precisely when a checkpoint matters most.
- Controlled-loss checkpoints use the same committer seam, so abort/kill and watchdog quiescence inherit the same lint gate.

## Behavior

- Every per-iteration and controlled-loss checkpoint runs scoped `bun biome format --write` best-effort, then commits the WIP snapshot unconditionally when there are file changes.
- A lint or format-tool failure on a durability checkpoint never prevents the commit or settles `iteration_commit_failed` for that reason alone.
- The terminal completion commit path keeps its existing strict scoped `biome check --write` hygiene; lint enforcement remains at the ready gate and CI.

## Decisions

- Durability checkpoints use `bun biome format --write` best-effort and always commit on file changes; rules out `biome check` linter failures gating the per-turn floor.
- Lint and complexity enforcement stay at the ready gate and CI; rules out weakening those gates to compensate.
- Terminal completion commits keep strict pre-stage `biome check --write` behavior via a separate formatter from checkpoint best-effort formatting; rules out silently dropping format hygiene from the completion boundary.
- Scope is the checkpoint commit path only, not a reprompt loop for biome-ignore or helper extraction; rules out folding [[implement-biome-complexity-commit-strand-is-resumable]] into this change (cross-link when either lands).

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` test `per-iteration checkpoint commits despite biome complexity lint on staged edit` drives a settled iteration whose staged edit trips `noExcessiveCognitiveComplexity`, asserts the turn's edits are on the branch afterward, and does not settle `iteration_commit_failed`; it fails against the current `biome check --write` committer that throws on the lint error.
- [ ] The checkpoint commit path is covered by a killing test proving it uses the best-effort formatter, not the terminal completion's fail-closed `biome check --write`: swapping the checkpoint's format call to the strict completion path turns a scoped `write-loop.test.ts` test red (the lint-dirty checkpoint would then fail to commit).
- [ ] `v2/src/execution/write-loop.test.ts` test `controlled-loss checkpoint commits despite biome complexity lint on quiesced edit` covers abort/kill or watchdog quiescence with a lint-dirty staged edit and asserts checkpoint commit success; it fails against the current lint-gated committer.
- [ ] `completion-commit.test.ts` test `formats changed files before staging so committed tree passes biome check` stays green (terminal completion hygiene unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — per-iteration and controlled-loss checkpoints commit unconditionally; checkpoint hygiene is best-effort `biome format --write` and lint enforcement stays at the ready gate, not a durability gate.
- `v2/docs/operator-runbook.md` — update the cognitive-complexity / biome-commit-strand gotcha: a complexity error no longer strands a turn's checkpointed work; it surfaces at the ready gate instead.
- `v2/docs/v1-behaviors.md` — record that durability checkpoints use best-effort `biome format --write` while terminal completion keeps fail-closed scoped `biome check --write`.
