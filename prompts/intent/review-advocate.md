---
id: intent.prompt.review.advocate
behavior: intent
kind: step
revision: 1
placeholders: [STAGED_INTENT:string!, SPEC_GUIDANCE:string!, ADVERSARY_FINDINGS:string!, REVIEW_PASS_NUMBER:string!, REVIEW_PASS_CONTEXT:string!]
remove: [global.naming]
---
# Intent Review — Advocate

Read the staged ready-intent and respond fairly to the adversary findings. Explain which concerns are addressed by the intent and acknowledge valid gaps. Do not edit files or write a verdict file.

## Staged Intent

<<<STAGED_INTENT_BEGIN>>>
<STAGED_INTENT>
<<<STAGED_INTENT_END>>>

## Spec Guidance

<<<SPEC_GUIDANCE_BEGIN>>>
<SPEC_GUIDANCE>
<<<SPEC_GUIDANCE_END>>>

## Adversary Findings

<<<ADVERSARY_BEGIN>>>
<ADVERSARY_FINDINGS>
<<<ADVERSARY_END>>>

## Review Context

<REVIEW_PASS_CONTEXT>

## Rules

- Read-only: do not edit the staged intent or write files.
- Address every finding concisely.
