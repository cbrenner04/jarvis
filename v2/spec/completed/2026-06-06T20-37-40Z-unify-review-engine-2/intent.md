---
name: unify-review-engine-2
---
# Intent: one review flow for plan and patch, driven off `modes.review`

Patch review has landed, and plan review already existed. They now solve the
same harness problem twice: run review-tier agents for N critique passes, enforce
mode boundaries, commit pass output, surface blockers, and record review
telemetry. Their prompts and write policies differ; the control flow should not.

## Why

- Two review loops will drift in agent fallback, quota handling, pass numbering,
  telemetry, blocker handling, and commit/PR refresh behavior.
- `modes.review` is the dedicated critique tier. Patch review already uses it;
  plan review still reads `modes.plan.agentOrder` and hardcodes default passes.
- Review should be a first-class harness flow with mode adapters, not a copy of
  whichever mode got review support first.

## Desired outcome

A v1-only shared review runner under `v1/src/modes/review/` is consumed by both
plan and patch. The runner owns the common review lifecycle:

- resolve passes from `--review-passes` -> `modes.review.passes` -> default 2
- resolve agents from `modes.review.agentOrder ?? modes.plan.agentOrder`
- run each pass with timeout, logging, quota fallback, and model-config handling
- call mode hooks for prompt building, write-boundary enforcement, blockers,
  commits, PR refresh, finalization, and telemetry

Plan and patch remain different only where the mode requires it:

- plan review rewrites spec files and allows `intent.md` blocker appends
- patch review refactors implementation code and reverts spec-tree edits
- plan keeps resume pass numbering and `plan: review N rK` subjects
- patch keeps baseline/final `bun run ready` and `gh pr ready`
- prompts stay mode-specific

## Architecture

Add a small review module such as:

- `v1/src/modes/review/runner.ts`: pass loop and result handling
- `v1/src/modes/review/types.ts`: adapter contract and telemetry/result types
- `v1/src/modes/review/agents.ts`: review-agent construction/resolution if useful

The adapter contract should be concrete, not over-generalized. Expected hooks:

- `buildPrompt(pass)`
- `beforePass?(pass)`
- `handleSuccessfulPass(pass, result, agentLabel)`
- `handleBlocker?(pass, result, agentLabel)`
- `commitPass(pass, agentLabel)`
- `recordAttempt(attempt)`
- `log(event)`
- `afterAll?()`

Exact names can change, but acceptance criteria must prove plan and patch call
the same runner for their review pass loop.

## Location

Keep this in `v1/src/modes/review/`, not `shared/**`.

- `shared/**` is for code consumed by both v1 and v2. There is no v2 review
  consumer.
- The runner depends on v1 runtime concepts: agents, telemetry, git commits,
  PR refresh, and mode docs. Putting it in `shared/**` would force injection
  indirection before there is a second versioned consumer.

## Scope

- Define the review flow contract and tests first.
- Move plan review onto the shared runner, including `modes.review` agents and
  passes.
- Move patch review onto the shared runner without regressing baseline/final
  ready gates, spec-tree reverts, blocker comments, or PR readiness.
- Update behavior docs so plan and patch review are described as one shared flow
  with mode-specific adapters.

## Non-Goals

- Do not merge plan and patch prompts.
- Do not change plan refine/draft behavior.
- Do not change patch implementation-loop semantics.
- Do not add new config keys.
- Do not move code into `shared/**`.
