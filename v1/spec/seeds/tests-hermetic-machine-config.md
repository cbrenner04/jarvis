# Agent-authored tests must not read the ambient machine config

## Problem

Patch runs sometimes author unit tests that call into code resolving the machine
profile from the real `~/.jarvis/config.json` (via `resolveMachineProfile` /
`loadWorkflowSteps` without an injected profile). These pass on the operator's
machine (valid config) but fail **only in CI**, where the runner's
`~/.jarvis/config.json` is absent or lacks `machineProfile`: the code throws
`missing required 'machineProfile' key` instead of the behavior under test.

Observed 2026-07-11 on `workflow-loader-review-debate-steps`: the new test
"aggregates missing bindings across debate roles" failed CI this way; recovered
with `jarvis1 review-feedback`, which had the agent inject a profile/config
fixture. The sibling `review-steps` spec's equivalent test was written hermetically
and passed — so the fix is known, just not enforced.

## Decisions

- Bias the patch rules / prompt (`v1/src/modes/patch/rules.md` or the v2 write
  prompt) so v2 tests that touch machine-config resolution inject a profile and
  config fixture rather than reading `~/.jarvis/config.json`.
- Consider a test-harness guard that points `HOME`/config path at a temp dir
  during `test:v2` so ambient-config reads fail loudly locally, not only in CI.

## Prerequisites

- none

## Reference

- CI-only failure pattern — operator runbook § Manual-finalize recovery
  (CI-only failure) and § Sandbox blindness.
