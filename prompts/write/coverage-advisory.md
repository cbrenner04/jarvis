---
id: write.coverage-advisory
behavior: write
kind: step
revision: 1
placeholders: [SPEC_PATH:string!, STEP_RULES:string!, COVERAGE_REPORT:string!]
---
Read the spec at <SPEC_PATH>.

Your changes include production code that tests do not execute:

<COVERAGE_REPORT>

An executed line may still lack sufficient assertions. The mutation verifier, not coverage, decides whether changes are adequately tested. Adding coverage for these lines is optional and will not block this run.

Consider whether these uncovered lines merit test assertions. Then return exactly one terminal token when done.

<STEP_RULES>
