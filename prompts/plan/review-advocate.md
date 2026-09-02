---
id: plan.prompt.review.advocate
behavior: plan
kind: step
revision: 5
placeholders: [WORKDIR:string!, NAME:string!, INTENT:string!, CURRENT_SPEC:string!, SPEC_GUIDANCE:string!, ADVERSARY_FINDINGS:string!, REVIEW_PASS_CONTEXT:string!]
remove: [global.naming]
---
# Plan Mode — Review: Advocate

Respond fairly to the adversary's findings. Explain which concerns are addressed by the spec and acknowledge valid gaps. Do not edit files or propose rewrites.

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

## Adversary Findings

<<<ADVERSARY_BEGIN>>>
<ADVERSARY_FINDINGS>
<<<ADVERSARY_END>>>

## Context

<REVIEW_PASS_CONTEXT>

## Rules

- Read-only: do not edit or commit spec files or run tests.
- For each adversary concern: explain why the spec addresses it (intent, implicit AC, or scope), or acknowledge it as valid.
- For an oversized-subspec finding, assess whether the identified paths are independently implementable with focused verification. Do not defend prose compression as a split.
