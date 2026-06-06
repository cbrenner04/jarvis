# Define shared review flow

Introduce a v1 review runner that owns the common pass loop for plan and patch. This slice may use tests with fake adapters only; it does not need to migrate either mode yet.

## Decisions

- The runner lives under `v1/src/modes/review/`.
- The runner resolves review passes with `resolveReviewPasses(cfg, cliOverride)` and review agents with `resolveReviewAgentOrder(cfg)`.
- The runner owns pass iteration, agent invocation, timeout, quota fallback, model-config handling, hard-error handling, and common attempt telemetry shape.
- Mode adapters own prompt text, write-boundary policy, blocker source/reporting, commit/PR refresh behavior, and final mode-specific gates.
- Prompt prose is not shared in this slice.

## Task checklist

- Add review runner/types under `v1/src/modes/review/`.
- Define a minimal adapter contract that can express both current plan and patch review behavior.
- Add unit tests with fake agents/adapters for shared pass-loop behavior.
- Keep existing plan and patch behavior unchanged until the migration subspecs.

## Acceptance criteria

- [ ] A shared review runner exists under `v1/src/modes/review/` and is independent of plan-only or patch-only modules.
- [ ] Runner tests prove pass count resolution honors `--review-passes` override -> `modes.review.passes` -> default 2.
- [ ] Runner tests prove review agents resolve from `modes.review.agentOrder ?? modes.plan.agentOrder`.
- [ ] Runner tests prove quota fallback advances to the next review agent and all-agent quota exits with code 2.
- [ ] Runner tests prove `model_config` exits with code 3 and hard agent errors exit nonzero without silently continuing.
- [ ] Runner tests prove the adapter is called to build prompts, enforce writes, handle blockers, commit successful passes, and record telemetry.
- [ ] Existing plan and patch review tests still pass before mode migration.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- None in this slice unless public behavior changes unexpectedly.
