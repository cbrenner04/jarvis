---
name: harness-owned-patch-routing
---
# Harness-owned patch routing and prompt slimming

**Scope.** Patch prompt assembly, `patch/rules.md` iteration section, review/shrink diff context.

## Problem

Harness computes active subspec (`getActiveLinkedSubspecPath`) but the prompt still tells the agent to pick the first unchecked link — duplicate routing, wasted tokens, occasional mismatch. Repo guidance is discover-yourself. Implementation iterations inline the full spec tree. Review/shrink prompts inline unbounded full branch diff.

## Desired behavior

Patch implementation prompt injects harness-selected active subspec path and inlined subspec body; agent executes, does not route. `patch.rules` iteration section shortens accordingly. Bounded preload of `AGENTS.md` and root `CLAUDE.md`. Implementation iterations receive active subspec only, not the full spec tree. Review/shrink prompts cap or summarize branch diff (stat + changed paths; full diff only for allowlisted shrink files).

## Decisions

- Harness owns subspec selection for implementation iterations; agent prompt does not repeat routing instructions. Rules out dual routing where agent re-derives active subspec.
- Implementation iterations get active subspec body only. Rules out inlining the full index-routed spec tree on every patch agent call.
- Repo guidance preload is bounded to `AGENTS.md` + root `CLAUDE.md`. Rules out unbounded repo doc discovery in the prompt.
- Review/shrink default to diff stat + changed paths; full diff only on shrink allowlist. Rules out unbounded full branch diff in read-only review/shrink prompts.

## Acceptance signals

- Prompt fixture snapshots reflect injected active subspec path/body and slimmed iteration rules.
- Tests prove implementation prompt omits full spec tree and includes only the active subspec.
- Tests prove review/shrink diff context is capped/summarized per contract.
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: harness-owned subspec routing and prompt preload bounds.
- `v2/docs/v1-behaviors.md`: patch routing and prompt context behavior.

## Out of scope

- Shared spec parser extraction (separate intent).
- Plan mode prompt changes.
- Auto-tick on completion.

## Prerequisites
