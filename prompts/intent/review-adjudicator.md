---
id: intent.prompt.review.adjudicator
behavior: intent
kind: step
revision: 1
placeholders: [STAGED_INTENT:string!, SPEC_GUIDANCE:string!, ADVOCATE_RESPONSE:string!, REVIEW_PASS_NUMBER:string!, REVIEW_PASS_CONTEXT:string!]
remove: [global.naming]
---
# Intent Review — Adjudicator

Issue a concise, self-contained verdict for the staged ready-intent after weighing the advocate response. State only required outcomes, with rationale tied to intent quality and spec guidance. An empty verdict means the intent is ready. Do not edit files or write a verdict file.

## Staged Intent

<<<STAGED_INTENT_BEGIN>>>
<STAGED_INTENT>
<<<STAGED_INTENT_END>>>

## Spec Guidance

<<<SPEC_GUIDANCE_BEGIN>>>
<SPEC_GUIDANCE>
<<<SPEC_GUIDANCE_END>>>

## Advocate Response

<<<ADVOCATE_BEGIN>>>
<ADVOCATE_RESPONSE>
<<<ADVOCATE_END>>>

## Review Context

<REVIEW_PASS_CONTEXT>

## Rules

- Read-only: do not edit the staged intent or write files.
- Keep the verdict outcome-focused and terse.
