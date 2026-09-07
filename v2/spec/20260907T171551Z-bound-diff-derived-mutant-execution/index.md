# Bound diff-derived mutant execution

- [ ] [00 - Verifier bounded killing-test execution](./00-verifier-bounded-killing-test-execution.md)
- [ ] [01 - Applied-mutant sidecar records](./01-applied-mutant-sidecar-records.md)
- [ ] [02 - Guard-flip while-true regression](./02-guard-flip-while-true-regression.md)
- [ ] [03 - Write-loop non-terminating settlement](./03-write-loop-non-terminating-settlement.md)
- [ ] [04 - Document bound diff-derived mutation verification](./04-document-bound-diff-derived-mutation-verification.md)

Land **00 → 01 → 02 → 03 → 04** when batched: later subspecs depend on bounded subprocess execution, verifier outcome classification, and sidecar hooks from earlier ones. Subspec 03 depends on the `non-terminating-mutation` verifier result from 00. Subspec 02 depends on 00's subprocess bound (reachable on `runDiffDerivedScopedTests` unbounded `runAsync` await today). Operator docs land in 04.
