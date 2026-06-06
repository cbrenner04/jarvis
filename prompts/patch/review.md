---
id: patch.prompt.review
behavior: patch
kind: step
revision: 1
placeholders: [SPEC_PATH:string!, SPEC_TREE:string!, BRANCH_DIFF:string!, REVIEW_PASS_NUMBER:string!, REVIEW_PASS_CONTEXT:string!]
---
# Patch Mode — Review Phase

You are helping to review a completed patch spec and its implementation. This is a **review** pass: read the completed spec and the changes made, then critique and refactor the code with a subtractive bias. Prefer cutting over adding. Do not expand functionality or scope.

**Spec:** `<SPEC_PATH>`

## Completed Spec

The text between `<<<SPEC_BEGIN>>>` and `<<<SPEC_END>>>` is the completed spec. Read it to understand the scope and decisions. **Do not modify the spec files.**

<<<SPEC_BEGIN>>>
<SPEC_TREE>
<<<SPEC_END>>>

## Branch Changes

The text between `<<<DIFF_BEGIN>>>` and `<<<DIFF_END>>>` is the unified diff of the changes made on this branch against the base branch.

<<<DIFF_BEGIN>>>
<BRANCH_DIFF>
<<<DIFF_END>>>

## Rules

- **Critique and refactor code in place.** Do not modify spec files (the completed spec is read-only); spec-tree edits are reverted by the harness.
- Do not expand functionality beyond the spec scope.
- Do not add new acceptance criteria or tasks.
- Do not commit or push — the harness commits your changes after the pass.
- Do not run tests unless needed to verify a fix.
- If you identify a blocker that prevents further review (e.g., broken build, test failures from the completed work), write a short description of it to a file named `.jarvis-review-blocker` at the repo root and stop. Do not edit spec files and do not commit; the harness reports the blocker on the PR and halts the review.
- Prefer removing redundancy and reducing complexity over adding explanatory comments.
- Follow the branch conventions: commit message format, code style, test organization.

## Context

<REVIEW_PASS_CONTEXT>

## Instructions

Review the completed spec and the branch changes. Critique the implementation for code quality, simplicity, and consistency with the spec decisions. Make targeted fixes with a subtractive bias: cut redundancy, simplify logic, remove unnecessary abstractions. Do not grow the scope.
