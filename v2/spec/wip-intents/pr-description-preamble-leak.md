# PR descriptions leak agent preamble into the narrative

**Scope.** v1 harness work — `v1/src/modes/plan/pr.ts`,
`v1/src/modes/patch/pr.ts`, the shared PR-description prompt, docs. Lives in
`v2/spec/wip-intents/` for routing.

## Problem

`generatePrDescription` (plan: `pr.ts:377`, patch: `pr.ts:76`) returns the
agent's entire `result.stdout` verbatim, gated only by
`description.includes("Decisions:")`. Conversational/thinking preamble emitted
before the real description passes that check and gets wrapped into the PR
narrative.

Observed on a plan PR — the body opened with: "I'll review the actual spec files
on disk to ensure the PR description matches the work as specified.This is a
plan-mode branch. Let me find the actual spec files..." before any real content.

Two prior fixes (#184, #192) were prompt-only tweaks. They don't hold: prompt
instructions alone can't reliably suppress preamble from models (e.g. Claude's
`result` field carries the full final message).

## Desired behavior

The PR narrative contains only the authored Description + `Decisions:` block,
never agent preamble — regardless of model chatter. Both plan and patch modes.

Primary lever: stop trusting raw stdout. Have the prompt wrap the description in
explicit sentinel delimiters and have the code extract only the content between
them; absent or malformed sentinels → return `null` and fall back to the
deterministic header (current null-path behavior).

## Decisions

- Enforcement lives in code (extraction), not just the prompt. The prompt earns
  its keep by emitting the sentinels; the code is the guarantee.
- Fix both `generatePrDescription` implementations and the single shared prompt
  fragment so plan and patch stay in lockstep.
- Keep the existing fallback: no valid narrative → deterministic header only,
  no leaked text.
- Don't strip preamble heuristically — there's no reliable description/preamble
  boundary without explicit delimiters.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: PR-body narrative generation and the
  sentinel/fallback contract.

## Out of scope

- Changing the narrative markers, hash-guard, or human-edit preservation in
  `v1/src/pr.ts`.
- Reformatting the Description/Decisions shape itself.
