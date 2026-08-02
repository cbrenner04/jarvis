- Split the combined mutation checkpoint into independently verifiable acceptance criteria for `implement-workflow-steps.test.ts` and `write.test.ts`. The verifier resolves one test basename per criterion, so both consumer filters otherwise are not guaranteed coverage.

- Correct the problem statement’s `already_complete` semantics. Misclassification wrongly admits a no-op implement run; correct classification makes `implement.already_complete` the expected preflight result. Terminal write must still complete rather than return `contract_miss`.

- Add acceptance coverage for the required documentation outcomes: update `v2/docs/workflow-runner.md` and remove the obsolete workaround from `v2/docs/operator-runbook.md`. Tasks alone do not gate Jarvis completion.

- Accurately bound the documentation claim. This spec must not claim all contradictory guidance is resolved while injected write-step guidance and `v1/docs/run-loop.md` retain trailing-marker semantics. Explicitly identify their deferred owner and sequencing expectation without duplicating the sibling intent’s scope.

- Replace ambiguous “whole-phrase” wording with the prerequisite parser’s actual contract: each exact marker string is recognized as a case-insensitive contiguous substring anywhere in the assembled criterion block. Marker-boundary variants remain parser-owned; these execution-loop regressions may stay focused on wrapped `(Manual)`.
