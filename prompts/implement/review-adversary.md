---
id: implement.prompt.review.adversary
behavior: patch
kind: step
revision: 2
placeholders: [SPEC_PATH:string!, SPEC_TREE:string!, BRANCH_DIFF:string!, REVIEW_PASS_NUMBER:string!, REVIEW_PASS_CONTEXT:string!]
---
# Implement Mode — Review: Adversary

Critically review the completed spec and branch changes. Report problems only — do not edit code or propose fixes.

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

## Context

<REVIEW_PASS_CONTEXT>

## Rules

- Read-only: do not edit or commit spec or code; do not run tests.
- Find edge cases, spec/code gaps, quality issues, missed acceptance criteria, and bugs.
