---
id: plan.prompt.review.adversary
behavior: plan
kind: step
revision: 8
placeholders: [WORKDIR:string!, NAME:string!, INTENT:string!, CURRENT_SPEC:string!, SPEC_GUIDANCE:string!, REVIEW_PASS_CONTEXT:string!]
remove: [global.naming]
---
# Plan Mode — Review: Adversary

Critically review the spec draft against the intent and guidance. Find problems, gaps, and risks in the spec — do not edit files or propose rewrites.

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
- Identify: ambiguities, missing acceptance criteria, decision gaps, design risks, unaddressed edge cases, guidance violations.
- Oversized subspecs: any subspec exceeding one implementation path with focused verification — identify its independently implementable paths; do not treat prose compression as a remedy.
- Structural **product** acceptance criteria that mandate files, modules, tables, or shapes when structure is not the contract (flag for rewrite into observable outcomes).
- Unfalsifiable premises listed in Context under `## Unfalsifiable premises`: include each injected finding in your report.
