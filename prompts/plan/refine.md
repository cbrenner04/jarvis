---
id: plan.prompt.refine
behavior: plan
kind: step
revision: 10
placeholders: [WORKDIR:string!, NAME:string!, INTENT:string!, SPEC_GUIDANCE:string!, TURNS_REMAINING:string!]
remove: [global.naming]
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
- Preserve leading frontmatter (`--- ... ---`) exactly, including `name:` — naming was finalized in the intent-draft step.
- Preserve the post-seed layout above `## Refinement` exactly: `## Raw seed`, its `<details>`/`<summary>` wrapper, the `<<<RAW_SEED_BEGIN>>>` / `<<<RAW_SEED_END>>>` block, and `## Intent` must remain byte-for-byte unchanged.
- Refine owns everything from `## Refinement` onward. Rewrite/consolidate that region in place each turn.
- Do not commit or push.
- Do not run tests.
- Do not write any other files.
- Do not propose self-referential deliverables that only grade spec prose in this active spec tree; acceptance criteria must verify target state outside the active spec directory (code, tests, docs, operator behavior, or generated evidence).

## Persisted outcomes (pick one)

You must leave the intent in a state that honestly reflects this non-interactive pass:

1. **Refinement** — Leave one `## Refinement` section (exact heading, level 2). Add only load-bearing decisions/constraints/assumptions/risks not already captured: ones where a competent implementer would plausibly choose differently and the difference is observable or costly to reverse. Each entry must name the plausible wrong alternative it rules out; if it has none, a reasonable implementer — even a smaller, cheaper model — would reach it anyway, so do not add it. Do not restate, rephrase, or lightly rescope existing entries. Preserve every prior decision/constraint/assumption/risk unless genuinely superseded; when superseding, keep the sharpened form and state what it supersedes.

2. **Explicit skip** — Skip is the expected outcome once the load-bearing decisions are captured. If this turn has no genuinely missing load-bearing decision to add — only inferable defaults, restatements, or polish — include `## Refine skip` (exact heading, level 2) and say so in a line or two. Keep the existing `## Refinement` region unchanged if present. Prefer skipping over adding a marginal entry.

3. **Blocker** — If drafting would be irresponsible without human clarification you cannot infer from the repo, include `## Blocker` (exact heading, level 2) describing what is needed. Do not invent facts or fake answers.

Never finish this phase with only a frontmatter tweak and no `## Refinement`, `## Refine skip`, or `## Blocker` body section as above.

## Multi-turn budget

When turns remain after a refinement turn, later runs continue consolidating the same `## Refinement` ledger. Default to `## Refine skip`: add only when a load-bearing, non-inferable decision is genuinely missing. Use skip for turns that would only restate earlier entries or add defaults an implementer would reach anyway. Cut restatement, narrative, and inferable defaults; preserve load-bearing decisions unless genuinely superseded. No numeric cap or target length applies.

## Context

Turns remaining: <TURNS_REMAINING>

## Instructions

Read the intent and repo context. Either record only net-new load-bearing decisions in `## Refinement`, include `## Refine skip` (the expected outcome) when nothing load-bearing is missing, or include `## Blocker` if human input is required. Follow heading contracts exactly (`## Refinement`, `## Refine skip`, `## Blocker`).
