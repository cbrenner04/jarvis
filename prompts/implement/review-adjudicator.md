---
id: implement.prompt.review.adjudicator
behavior: patch
kind: step
revision: 2
placeholders: [SPEC_PATH:string!, SPEC_TREE:string!, BRANCH_DIFF:string!, ADVOCATE_RESPONSE:string!, REVIEW_PASS_NUMBER:string!, REVIEW_PASS_CONTEXT:string!]
---
# Implement Mode — Review: Adjudicator

Issue a concise, self-contained verdict after weighing the advocate response. State only required outcomes with rationale. An empty verdict means no actuator changes are needed. Do not edit code.

**Spec:** `<SPEC_PATH>`

## Completed Spec

<<<SPEC_BEGIN>>>
<SPEC_TREE>
<<<SPEC_END>>>

## Branch diff

merge-base branch diff: stat, changed paths, then unified diff from `git merge-base <base> HEAD` and `git diff <mergeBase> HEAD`.

<<<DIFF_BEGIN>>>
<BRANCH_DIFF>
<<<DIFF_END>>>

## Advocate Response

<<<ADVOCATE_BEGIN>>>
<ADVOCATE_RESPONSE>
<<<ADVOCATE_END>>>

## Context

<REVIEW_PASS_CONTEXT>

## Rules

- Read-only: do not edit or commit spec or code; do not run tests.
- Outcome-focused verdict only — no detailed diff prescription.
- Self-contained: the actuator reads only your verdict, not adversary or advocate artifacts. Restate upheld findings without "the adversary said" or "the advocate claimed."
- If there are no valid issues that require the actuator to take action, issue an empty verdict (no content).
