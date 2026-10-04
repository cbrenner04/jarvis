---
name: patch-rules-require-hermetic-config-tests
---

# Patch rules require hermetic machine-config tests

Patch runs author tests that call machine-config resolution (`resolveMachineProfile`,
`loadWorkflowSteps` without an injected profile) with no fixture, because nothing in
the prompt tells them not to. Observed 2026-07-11 on
`workflow-loader-review-debate-steps`: the test passed locally and failed only in CI;
the sibling `review-steps` spec's equivalent test was hermetic and passed.

Add a rule to the patch-mode rules the agent is given: a test that reaches machine-config
resolution must inject a profile and an explicit config path/fixture, never read the
ambient machine config. Keep it one terse rule, and cover it with the prompt-governance
test surface so the rule cannot silently disappear.

Scope: prompt/rules text plus its governance test. No runtime or test-harness change.

## Prerequisites
