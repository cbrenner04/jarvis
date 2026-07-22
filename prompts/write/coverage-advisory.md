---
id: write.coverage-advisory
behavior: write
kind: step
revision: 1
placeholders: [SPEC_PATH:string!, STEP_RULES:string!, COVERAGE_REPORT:string!]
---
Read the spec at <SPEC_PATH>.

The following changed production lines were not executed by any test:

<COVERAGE_REPORT>

An executed line may still be unasserted. The mutation verifier, not coverage, decides adequacy.
Adding test coverage for these lines is optional and will not block this run.

Return exactly one terminal token when done.

<STEP_RULES>
