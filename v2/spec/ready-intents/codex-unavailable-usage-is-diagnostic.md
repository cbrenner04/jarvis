---
name: codex-unavailable-usage-is-diagnostic
---

# Make Missing Codex Usage Diagnostic

Successful Codex work can reach `invocation_completed` telemetry with null usage, null cost, and no warning. Operators then read uncosted Codex work as free.

## Decisions

- Every successful Codex invocation without usage records `usage_source: "unavailable"`, `cost_source: "no-usage"`, and a warning naming the failed source; rules out the generic silent `cost_source: "unavailable"` fallback.
- Preserve the successful invocation result when accounting is unavailable; rules out turning telemetry loss into agent failure.
- Cover every no-usage exit from Codex result finalization with one regression surface; rules out testing only the three existing session-correlation failures.
- Keep session correlation in this slice; rules out coupling the diagnostic fix to the larger usage-source migration.

## Behavior

- Add a failing shared-invocation regression for the correlated-session path that currently returns null telemetry without warnings.
- Normalize all successful Codex no-usage results to explicit unavailable usage, no-usage cost, and a reason warning.
- Keep known correlation failures distinguishable in warning text.

## Documentation updates

- Update `v1/docs/operator-runbook.md` cost reporting to identify Codex null usage as a cost hole that must be reported, not `$0`.
- Update `v2/docs/operator-runbook.md` actuator guidance with the Codex attribution gap and cleanup trigger.
- Update `v2/docs/shared-invocation.md` with the no-usage telemetry contract.
- Update `v2/docs/v1-behaviors.md` for the changed v1 Codex telemetry behavior.

## Out of scope

- Replacing Codex session-file correlation.
- Codex pricing rows.
- Cursor usage reporting.

## Prerequisites
