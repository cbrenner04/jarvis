---
id: implement.prompt.review.critic
behavior: patch
kind: step
revision: 2
placeholders: [SPEC_PATH:string!, SPEC_TREE:string!, BRANCH_DIFF:string!, REVIEW_PASS_NUMBER:string!, REVIEW_PASS_CONTEXT:string!]
---
# Implement Mode — Review: Critic

Review the completed spec and branch changes. Issue a concise, self-contained outcome verdict for the actuator — do not edit code.

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
- Outcome-focused verdict only — state what must be true, not implementation details.
- Self-contained: the actuator reads only your verdict, not prior review artifacts.
- If the branch needs no changes, emit an empty verdict (no content).
