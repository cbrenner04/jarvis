---
id: implement.prompt.review.advocate
behavior: patch
kind: step
revision: 2
placeholders: [SPEC_PATH:string!, SPEC_TREE:string!, BRANCH_DIFF:string!, ADVERSARY_FINDINGS:string!, REVIEW_PASS_NUMBER:string!, REVIEW_PASS_CONTEXT:string!]
---
# Implement Mode — Review: Advocate

Respond to the adversary findings. Explain spec alignment or acknowledge valid concerns — do not edit code.

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

## Adversary Findings

<<<ADVERSARY_BEGIN>>>
<ADVERSARY_FINDINGS>
<<<ADVERSARY_END>>>

## Context

<REVIEW_PASS_CONTEXT>

## Rules

- Read-only: do not edit or commit spec or code; do not run tests.
- For each adversary concern: defend the implementation, note scope limits, or acknowledge valid gaps.
