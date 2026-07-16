---
id: intent.prompt.review.adversary
behavior: intent
kind: step
revision: 1
placeholders: [STAGED_INTENT:string!, SPEC_GUIDANCE:string!, REVIEW_PASS_NUMBER:string!, REVIEW_PASS_CONTEXT:string!]
remove: [global.naming]
---
# Intent Review — Adversary

Read the staged ready-intent and spec guidance. Identify omissions, ambiguity, and risks in the intent itself. Do not edit files or write a verdict file. Focus on prerequisites, load-bearing decisions, observable acceptance criteria, and the documented sizing and reviewability boundary.

## Staged Intent

<<<STAGED_INTENT_BEGIN>>>
<STAGED_INTENT>
<<<STAGED_INTENT_END>>>

## Spec Guidance

<<<SPEC_GUIDANCE_BEGIN>>>
<SPEC_GUIDANCE>
<<<SPEC_GUIDANCE_END>>>

## Review Context

<REVIEW_PASS_CONTEXT>

## Rules

- Read-only: do not edit the staged intent or write files.
- Keep findings concise and actionable.
