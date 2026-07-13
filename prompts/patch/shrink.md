---
id: patch.prompt.shrink
behavior: patch
kind: step
revision: 4
remove: [global.documentation, global.naming]
placeholders: [SPEC_PATH:string!, SPEC_TREE:string!, ALLOWLIST:string!, BRANCH_DIFF:string!, RUN_SCOPED_DIFF:string!, STEP_RULES:string!]
---
# Patch Mode — Post-completion Shrink

Simplify the implementation diff without changing behavior. The completed spec is read-only.

**Spec:** `<SPEC_PATH>`

## Completed Spec (read-only)

<<<SPEC_BEGIN>>>
<SPEC_TREE>
<<<SPEC_END>>>

## Allowed files

Edit only these paths. The harness reverts anything else.

<<<ALLOWLIST_BEGIN>>>
<ALLOWLIST>
<<<ALLOWLIST_END>>>

## Branch change summary

Orientation only — full unified diff for allowlisted files is below.

<<<BRANCH_SUMMARY_BEGIN>>>
<BRANCH_DIFF>
<<<BRANCH_SUMMARY_END>>>

## Run-scoped diff

Unified diff for allowlisted paths only.

<<<DIFF_BEGIN>>>
<RUN_SCOPED_DIFF>
<<<DIFF_END>>>

## Simplification checklist

Hunt and remove bloat matching these patterns only — no numeric line-count targets:

- derivable fields (values computable from other state)
- pass-through wrappers (functions/types that only forward without adding behavior)
- dead enum/status values (variants never read or written on live paths)
- 1:1 tables (parallel maps keyed the same way with no independent lifecycle)
- repeated test literals (duplicated fixtures that could share one helper)
- docs restating signatures (comments that repeat params/returns the types already express)
- machinery with no consumer yet (helpers, types, or config only referenced by dead code)
- local reimplementations of existing `shared/*` helpers (import the shared utility instead of inlining exec/spawn)

## Rules

- Do not edit spec files or tick/untick acceptance criteria.
- Do not add features, tests for new behavior, or expand scope.
- Preserve observable behavior; run tests before finishing.
- Prefer deletion. Reuse existing `shared/*` helpers before inlining; inline only when nothing shared fits.

<STEP_RULES>
