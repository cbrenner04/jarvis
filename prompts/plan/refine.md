---
id: plan.prompt.refine
behavior: agent-facing
kind: template
revision: 4
placeholders: [WORKDIR:string!, NAME:string!, INTENT:string!, SPEC_GUIDANCE:string!, TURNS_REMAINING:string!]
---
# Plan Mode — Intent Refinement Phase

You are refining a Jarvis plan **intent** before the draft phase runs. This phase is **not interactive**: you cannot ask the human questions, pause for answers, or record a Q&A. No interactive or poll-style user tooling is available.

**Working directory:** `<WORKDIR>`

**Spec directory:** `<NAME>`

## Current Intent

The text between `<<<INTENT_BEGIN>>>` and `<<<INTENT_END>>>` is the current content of `spec/<NAME>/intent.md`. Treat it as read-only except where the rules below allow changes.

<<<INTENT_BEGIN>>>
<INTENT>
<<<INTENT_END>>>

## Spec Guidance

The text between `<<<SPEC_GUIDANCE_BEGIN>>>` and `<<<SPEC_GUIDANCE_END>>>` is reference material describing the spec structure and conventions to follow.

<<<SPEC_GUIDANCE_BEGIN>>>
<SPEC_GUIDANCE>
<<<SPEC_GUIDANCE_END>>>

## Rules

- Inspect the target repo as needed (read-only exploration).
- Preserve any existing leading frontmatter block (`--- ... ---`) exactly, except that on your final write you must include/update `name: <kebab-case>` inside that block.
- On your final write, include a `name: <kebab-case>` line in leading frontmatter at the top of `intent.md`:

  ```md
  ---
  name: example-feature-name
  ---
  ```

- Name rules: lowercase kebab-case only (`[a-z0-9-]+`), reasonably short (max 40 chars), descriptive, and not reserved (`index`, `intent`).
- Preserve the human-authored seed exactly: everything above the first `## Refinement` heading is frozen and must not be rewritten, except the permitted `name:` frontmatter write on the final pass.
- Refine owns everything from `## Refinement` onward. Rewrite/consolidate that region in place each turn.
- Do not commit or push.
- Do not run tests.
- Do not write any other files.

## Persisted outcomes (pick one)

You must leave the intent in a state that honestly reflects this non-interactive pass:

1. **Refinement** — Leave one `## Refinement` section (exact heading, level 2). Consolidate new analysis into this single ledger: sharpen existing entries directly, merge duplicates, and fold restated points together. Preserve every prior decision/constraint/assumption/risk unless genuinely superseded; when superseding, keep the sharpened form.

2. **Explicit skip** — If the intent is already sufficient and you have nothing useful to add, include `## Refine skip` (exact heading, level 2). Briefly state that no refinement was applied (one short paragraph or a single line is enough). Keep the existing `## Refinement` region unchanged if present.

3. **Blocker** — If drafting would be irresponsible without human clarification you cannot infer from the repo, include `## Blocker` (exact heading, level 2) describing what is needed. Do not invent facts or fake answers.

Never finish this phase with only a frontmatter tweak and no `## Refinement`, `## Refine skip`, or `## Blocker` body section as above.

## Multi-turn budget

When turns remain after a refinement turn, later runs continue consolidating the same `## Refinement` ledger. Cut restatement and narrative; never drop decisions unless genuinely superseded. No numeric cap or target length applies.

## Context

Turns remaining: <TURNS_REMAINING>

## Instructions

Read the intent and repo context. Either consolidate useful planning notes in `## Refinement`, include `## Refine skip` if nothing should change, or include `## Blocker` if human input is required. Follow heading contracts exactly (`## Refinement`, `## Refine skip`, `## Blocker`).
