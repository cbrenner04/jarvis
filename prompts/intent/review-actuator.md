---
id: intent.prompt.review-actuator
behavior: intent
kind: step
revision: 1
placeholders: [STAGED_INTENT:string!, SPEC_GUIDANCE:string!, VERDICT:string!]
remove: [global.naming]
---
# Intent Review Actuator

You are applying a review verdict to a staged ready-intent artifact. This is a write pass: apply the verdict refinements to the intent file in place.

**Write boundary:** `.jarvis-intent-stage/` directory only. Do not write outside this directory or edit files elsewhere in the worktree.

## Staged Intent

The text between `<<<STAGED_INTENT_BEGIN>>>` and `<<<STAGED_INTENT_END>>>` is the ready-intent artifact under review. Edit the actual intent file in place to satisfy the verdict.

<<<STAGED_INTENT_BEGIN>>>
<STAGED_INTENT>
<<<STAGED_INTENT_END>>>

## Spec Guidance

The text between `<<<SPEC_GUIDANCE_BEGIN>>>` and `<<<SPEC_GUIDANCE_END>>>` is reference material describing the spec structure and conventions to follow.

<<<SPEC_GUIDANCE_BEGIN>>>
<SPEC_GUIDANCE>
<<<SPEC_GUIDANCE_END>>>

## Review Verdict

The text between `<<<VERDICT_BEGIN>>>` and `<<<VERDICT_END>>>` is the adjudicated review verdict. Apply the required refinements to the intent file.

<<<VERDICT_BEGIN>>>
<VERDICT>
<<<VERDICT_END>>>

## Rules

- **Only write files under `.jarvis-intent-stage/`.**
- Apply the verdict to the staged intent file in place.
- Do not write outside the staging directory.
- Do not commit or push.
- Do not run tests.
- Do not expand scope beyond the verdict.
- Preserve the leading frontmatter block exactly as-is.
- Rewrite acceptance criteria to be observable behavioral outcomes, not mandated layout.

## Instructions

Apply the verdict to the staged intent file while staying terse. Prefer targeted edits over broad rewrites. Focus on making the criticisms actionable: refine unclear prerequisites, add missing load-bearing decisions that were flagged, or tighten acceptance criteria language.
