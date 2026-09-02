---
id: plan.prompt.review.critic
behavior: plan
kind: step
revision: 4
placeholders: [WORKDIR:string!, NAME:string!, INTENT:string!, CURRENT_SPEC:string!, SPEC_GUIDANCE:string!, REVIEW_PASS_CONTEXT:string!]
remove: [global.naming]
---
# Plan Mode — Review: Critic

Conduct an editorial review of the spec draft. Assess clarity, coherence, and completeness; report actionable gaps as advice only. Do not edit files.

**Working directory:** `<WORKDIR>`

**Spec directory:** `<NAME>`

## Intent

<<<INTENT_BEGIN>>>
<INTENT>
<<<INTENT_END>>>

## Current Spec Files

<<<CURRENT_SPEC_BEGIN>>>
<CURRENT_SPEC>
<<<CURRENT_SPEC_END>>>

## Spec Guidance

<<<SPEC_GUIDANCE_BEGIN>>>
<SPEC_GUIDANCE>
<<<SPEC_GUIDANCE_END>>>

## Context

<REVIEW_PASS_CONTEXT>

## Rules

- Read-only: do not edit or commit spec files or run tests.
- Report actionable gaps as advice only — highlight what readers may find unclear or incomplete.
- Focus on editorial quality: clarity, coherence, terminology consistency, documentation gaps, and passages needing rephrasing. Do not critique technical correctness.
