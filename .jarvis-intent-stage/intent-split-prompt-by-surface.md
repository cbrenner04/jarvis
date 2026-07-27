---
name: intent-split-prompt-by-surface
---

# Intent split prompt fans out one ready-intent per touched surface

## Problem

The intent split emits one ready-intent per symptom. When one symptom's fix spans persistence,
daemon request handling, CLI admission, and execution-loop boundaries, a single intent carries every
surface into one plan and one implement run — oversized plans and broad test breakage.

## Decisions

- Split enumerates module-boundary surfaces the fix must change and emits one ready-intent per
  surface in dependency order — rules out one-intent-per-symptom and numeric file-count budgets.
- A surface is a boundary the fix must cross (persistence, daemon handling, CLI admission, execution
  loop), not a file count.
- Genuinely single-surface seeds emit one ready-intent and state in one line why splitting does not
  apply — rules out forced fragmentation.
- The surface rule is one added prompt sentence with no examples or thresholds — rules out prompt
  bloat from case lists.
- Multi-surface splits wire earlier-surface behaviors into later intents' `## Prerequisites` bullets
  in dependency order — rules out intent-name references or implicit ordering with no prerequisite
  text.
- Added prompt length must stay within the existing split-prompt budget test — rules out unbounded
  growth.

## Acceptance criteria

- [ ] `prompts/intent/split.md` instructs one ready-intent per touched surface in dependency order,
      cross-surface prerequisite bullets naming earlier-surface behaviors, single-surface unsplit with
      a one-line rationale, and contains no examples or numeric thresholds; a prompt-registry or
      `buildIntentSplitPrompt` test pins the rule and fails against the pre-change prompt.
- [ ] Total added split-prompt length stays within the existing split prompt budget test.
- [ ] Inverting the pinned surface-rule substring turns the registry/prompt test RED.

## Documentation updates

- `v1/docs/spec-guidance.md` — authored intents are split by surface, not by symptom.
- `v2/docs/workflow-runner.md` — intent split contract: one ready-intent per touched surface in
  dependency order.

## Prerequisites

