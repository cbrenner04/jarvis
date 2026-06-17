---
name: pr-description-sentinel-extraction
---
# PR narratives carry only the authored description, never agent preamble

**Scope.** v1 harness — `v1/src/modes/plan/pr.ts`,
`v1/src/modes/patch/pr.ts`, the shared `shared.pr-description` prompt fragment,
docs.

## Problem

`generatePrDescription` (plan and patch) returns the agent's entire
`result.stdout`, gated only by `description.includes("Decisions:")`.
Conversational/thinking preamble emitted before the real description passes
that check and is wrapped into the PR narrative. Observed on a plan PR: the body
opened with "I'll review the actual spec files on disk..." before any real
content. Two prior prompt-only fixes (#184, #192) did not hold — prompt
instructions alone can't suppress preamble (e.g. Claude's `result` carries the
full final message).

## Desired behavior

In both plan and patch modes, the PR narrative contains only the authored
Description + `Decisions:` block, regardless of model chatter. The shared prompt
wraps the description in explicit sentinel delimiters; the code extracts only
the content between them. Absent or malformed sentinels yield `null` and fall
back to the existing deterministic header (current null-path behavior — no
leaked text). Plan and patch stay in lockstep: one shared prompt fragment, both
`generatePrDescription` implementations enforce the same extraction.

## Decisions

- Enforcement lives in code (extraction), not the prompt — rules out a third
  prompt-only attempt that repeats #184/#192.
- Both `generatePrDescription` impls plus the single shared fragment change
  together — rules out fixing one mode and leaving the other leaking.
- Absent/malformed sentinels return `null` and fall back to the deterministic
  header — rules out emitting partial or best-effort narrative on malformed
  output.
- No heuristic preamble stripping — there is no reliable description/preamble
  boundary without explicit delimiters.

## Out of scope

- Narrative markers, hash-guard, or human-edit preservation in `v1/src/pr.ts`.
- Reformatting the Description/Decisions shape itself.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: PR-body narrative generation — the
  sentinel/extraction contract and the malformed/absent → deterministic-header
  fallback.
- `v2/docs/v1-behaviors.md`: update the PR-narrative generation entries to
  record sentinel-delimited extraction and the fallback (existing behavior
  changes; keeps the v1 parity baseline accurate).

## Prerequisites
