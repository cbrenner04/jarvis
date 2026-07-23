---
id: write.coverage-advisory
behavior: write
kind: step
revision: 1
placeholders: [COVERAGE_REPORT:string!]
---
Coverage check: some of your changed lines have no test executions:

<COVERAGE_REPORT>

Adding tests for these lines is optional and will not block the run. Whether executed lines have sufficient assertions is determined by mutation verification, not coverage. Return exactly one terminal token when done (or if no changes needed): done, no-work, or progress.
