# Unify review engine (plan + patch)

- [x] [00 - Define shared review flow](./00-define-shared-review-flow.md)
- [x] [01 - Move plan review onto shared flow](./01-plan-review-shared-flow.md)
- [ ] [02 - Move patch review onto shared flow](./02-patch-review-shared-flow.md)

## Direction

Review is one harness capability: run critique passes with review-tier agents, enforce each mode's write boundary, handle blockers, commit pass output, and report telemetry. Plan and patch should not own separate pass loops just because their prompts and allowed-write policy differ.

The shared code lives in `v1/src/modes/review/`, not `shared/**`. It is still v1-only runtime code. If v2 later grows a review consumer, promote it then.

## Flow Contract

One shared runner owns:

- pass count and review-agent resolution (`resolveReviewPasses`, `resolveReviewAgentOrder`)
- per-pass agent invocation, outbound/inbound logging, timeout handling, and quota fallback
- `ok` / `quota` / `model_config` / hard-error exit handling
- per-pass write-boundary hook execution
- blocker hook execution
- non-empty pass commit hook execution
- review telemetry hook execution

Mode adapters own:

- prompt construction and prompt snapshot tests
- pass-number display and resume suffix policy
- allowed-write validation or repair
- blocker source and reporting
- commit subject/body/PR-refresh behavior
- final mode-specific gates (`bun run ready`, `gh pr ready`, next-step output)

## Non-Goals

- Do not factor plan and patch review prompts into a shared prose fragment in this pass.
- Do not move code to `shared/**`.
- Do not change plan drafting/refine behavior or patch implementation-loop behavior.
- Do not change public config shape beyond making plan review honor existing `modes.review`.
