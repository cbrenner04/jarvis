# Cleanup PR ownership probes fail closed

- [x] [00 - Fail-closed PR ownership gate](./00-fail-closed-pr-ownership-gate.md)
- [x] [01 - Operator runbook gh PR-probe refusal](./01-operator-runbook-gh-pr-probe-refusal.md)
- [x] [02 - v1-behaviors PR ownership unknown](./02-v1-behaviors-pr-ownership-unknown.md)

Scope: stop `gateOnOpenPrs` from treating a failed `gh pr list` probe as a confirmed zero-open-PR result; refuse `--abandon` and stale-workspace reset before mutation when PR ownership is unknown; document operator recovery for unreachable `gh` including sandboxed callers.
