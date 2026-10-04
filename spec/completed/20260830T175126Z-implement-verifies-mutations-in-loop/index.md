# Verify diff-derived mutations in the implement loop

- [x] [00 - In-loop diff-derived mutation verification and reprompt](./00-in-loop-diff-derived-mutation-verification-and-reprompt.md)
- [x] [01 - In-loop equivalent-mutation acceptance and reprompt budget exhaustion](./01-in-loop-equivalent-mutation-and-budget-exhaustion.md)
- [x] [02 - Surviving-mutation reprompt resume parity](./02-surviving-mutation-reprompt-resume-parity.md)
- [x] [03 - Publication confirm-only mutation re-check](./03-publication-confirm-only-mutation-recheck.md)
- [x] [04 - Document implement mutation-verification lifecycle](./04-document-implement-mutation-verification-lifecycle.md)

Land **00 → 01 → 02 → 03 → 04** when batched: later subspecs depend on in-loop verification, reprompt events, and confirm-only publication semantics from earlier ones. Operator-facing docs and intent-level harness gates (`typecheck`, `test:v2`, `test:integration:v2`) land with subspec 04.
