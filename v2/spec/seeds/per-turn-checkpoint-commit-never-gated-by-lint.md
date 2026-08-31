# The per-turn durability checkpoint must never be gated by lint

## Problem

The per-iteration commit floor (`commitSettledIteration`, `v2/src/execution/write-loop.ts`, shipped 2026-07-27) is meant to guarantee every settled write-loop turn's work is committed before its SQLite boundary, so a crash/kill/timeout never strands uncommitted agent edits. But the committer it calls runs `bun biome check --write <paths>` (`v2/src/execution/completion-commit.ts:87`), and `biome check` runs the **linter**, not just the formatter. A non-autofixable lint error — `noExcessiveCognitiveComplexity` is the common one — makes it exit non-zero, the committer throws (`completion-commit.ts:101`), and the turn settles `iteration_commit_failed`, frequently projecting `unsupported_resume_context` (non-resumable).

Net effect: the durability floor is **conditional on the agent's code being lint-clean**. It fails precisely when the agent wrote something branchy — the moment a durability snapshot matters most. This is the same failure the [[implement-biome-complexity-commit-strand-is-resumable]] seed observes, but the root fix is broader than reprompt/resume: durability and lint enforcement are being conflated at the commit boundary.

## Evidence

Every implement strand of the 2026-08-30 session was this class (escape-hatch, idle-timeout-checkpoint, resolve-importing, idle-watchdog, execinv-01 salvage — each "work complete, died at the biome commit"). Biome complexity is deterministic, so a fresh re-run re-strands identically; each cost a full hand-salvage.

## Decisions

- The per-turn checkpoint commit (and the controlled-loss checkpoint) must be **unconditionally committable**: it may apply formatting best-effort, but a lint/format failure must never prevent the WIP snapshot from committing. Prefer `bun biome format --write` (format-only, cannot fail on lint), or run `biome check --write` best-effort and commit the tree regardless of its exit. Rules out `biome check`'s linter gating durability.
- Lint/complexity enforcement stays at the ready gate and CI, where it already lives — not at the durability floor. Rules out weakening the ready gate to compensate.
- The terminal completion commit keeps its existing hygiene expectations (it is the boundary the ready gate then judges); this seed changes only the per-iteration/controlled-loss durability checkpoints, so no turn's work is lost to a lint failure. Rules out silently dropping format hygiene from the completion boundary.
- Scope is the checkpoint commit path, not a new reprompt loop. [[implement-biome-complexity-commit-strand-is-resumable]] (reprompt the agent for a `// biome-ignore` / helper extraction) is complementary and can layer on top; this seed removes the strand at its structural source. Cross-link both when either lands.

## Acceptance criteria

- [ ] A write-loop test proves an iteration whose staged edit trips `noExcessiveCognitiveComplexity` still commits its per-iteration checkpoint (the turn's edits are on the branch afterward) rather than settling `iteration_commit_failed`; it fails against the current `biome check --write` committer that throws on the lint error.
- [ ] The controlled-loss checkpoint (abort/kill and watchdog quiescence) is covered by the same guarantee — a lint-dirty quiesced iteration is still checkpointed.
- [ ] The terminal completion boundary's hygiene behavior is unchanged (a test pins that the completion commit path still applies formatting).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the per-iteration and controlled-loss checkpoints commit unconditionally; lint/format hygiene is best-effort at the checkpoint and enforced at the ready gate, not a durability gate.
- `v2/docs/operator-runbook.md` — the "Agent-written cognitive complexity … NOT autofixable" gotcha and the biome-commit-strand notes update: a complexity error no longer strands a turn's committed work; it surfaces at the ready gate instead.

## Sequencing

P0/P1 gates-first — this is the structural root of the dominant implement-strand class. Sequence alongside or ahead of [[implement-biome-complexity-commit-strand-is-resumable]]; landing this first makes that seed a smaller reprompt-only quality-of-life add rather than a strand-recovery necessity.
