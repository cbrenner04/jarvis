# Pipeline restart treats pre-landing stage state as disposable

- [ ] [00 - Pipeline resume disposable-lane wiring](./00-pipeline-resume-disposable-lane-wiring.md)
- [ ] [01 - Operator runbook disposable restart](./01-operator-runbook-disposable-restart.md)
- [ ] [02 - Pipeline execution disposable restart contract](./02-pipeline-execution-disposable-restart-contract.md)
- [ ] [03 - v1-behaviors disposable restart](./03-v1-behaviors-disposable-restart.md)

Scope: failed-plan `pipeline resume` marks never-landed lanes disposable, passes `disposableLane` through shared stale-reset, rematerializes past descendant and landed-criteria drift, discards draft-tree operator `## Blocker`, and still refuses landed blockers and path-scoped unlanded commits; no new CLI flags; docs replace manual-teardown guidance and the prior cross-link deferral.
