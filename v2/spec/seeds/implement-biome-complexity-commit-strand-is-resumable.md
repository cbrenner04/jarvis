# Implement runs that fail the biome cognitive-complexity commit gate strand non-resumably, forcing full hand-salvage

## Problem

When an implement agent writes a new branchy function (a scheduler, a per-outcome mapper, a fan-out closure), it commonly trips biome `lint/complexity/noExcessiveCognitiveComplexity` (max 24) — often by only 1–5 over. The write loop's `bun biome check --write` at the iteration commit boundary then fails, the run settles `iteration_commit_failed`, and the row projects `unsupported_resume_context` (non-resumable). The fix is mechanical and small — place a `// biome-ignore …noExcessiveCognitiveComplexity: <reason>` directly above the flagged function/closure, or extract a helper — but because the run is non-resumable, the operator must hand-salvage the entire worktree every time (fix biome, commit, rebase, re-run gates, hand-publish, review, bookkeeping). Biome complexity is deterministic, so a fresh re-run re-strands identically.

## Evidence (2026-08-30)

Three implements stranded this way in one session, each with correct, complete work in the worktree: escape-hatch (`findLineCommentStart` complexity 30 → extracted scanners), idle-timeout-checkpoint (`committedResult` — the agent added a biome-ignore but misplaced it), resolve-importing (`verifyCandidates` per-file closure complexity 25 → placed ignore on the closure). Each cost a full hand-salvage. `iteration_commit_failed` is normally resumable (`nextAction: "resume"`), but these projected `unsupported_resume_context`.

## Decisions

- **Reprompt the live agent** on a biome-check-failure at the commit boundary, the same way surviving-mutation / landing / blocker reprompts work: surface the biome error (rule, function, "complexity N > 24") and instruct the agent to place a `// biome-ignore` with a reason or extract a helper preserving guard text, then re-attempt the commit within the normal iteration budget. Rules out stranding the run when the fix is a one-line agent edit.
- If a reprompt loop is out of scope, at minimum make the biome-commit-failure settle **resumable** (`iteration_commit_failed` / `nextAction: "resume"`) so `jarvis run resume` (or a gate-only tail) can pick up an operator's one-line fix without a full re-run. Rules out `unsupported_resume_context` for a committed-work-present strand.
- The agent-side prompt already warns about non-null assertions and inversion hooks; add an explicit "keep new functions under the cognitive-complexity limit; if unavoidable, add a `// biome-ignore …noExcessiveCognitiveComplexity: <reason>` above the function" rule to the implement write-step rules. Rules out relying on the agent to rediscover this each run.

## Acceptance criteria

- [ ] A write-loop test proves an iteration whose staged edit trips `noExcessiveCognitiveComplexity` at the commit boundary reprompts the live agent (naming the rule/function) and a subsequent iteration adding a `// biome-ignore` completes the run; it fails against the pre-fix loop that settles `iteration_commit_failed` → non-resumable.
- [ ] OR (if reprompt is deferred) a test proves a biome-commit-failure with committed prior progress settles `resumable: true` / `nextAction: "resume"`, and `jarvis run resume` re-attempts the commit after an operator fix.
- [ ] The implement/`write.mutation-repair` step rules mention the cognitive-complexity limit and the `// biome-ignore` remedy.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — a biome-complexity commit strand is recoverable via reprompt/resume (not a full re-run); the runbook's existing "Agent-written cognitive complexity … NOT autofixable" gotcha can then be trimmed.

## Sequencing

P1 gates-first — this is the dominant remaining implement-strand class now that the mutation-race false-positives are fixed (escape-hatch + serialize-per-file shipped 2026-08-30). Every strand this session was this class. Related: the write-loop reprompt machinery [[implement-verifies-mutations-in-loop]] adds for surviving mutations is the natural home for the biome reprompt arm.
