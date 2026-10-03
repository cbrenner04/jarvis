---
name: telemetry-confinement-recording
---

# Telemetry records resolved confinement policy and vendor mechanism per invocation

## Problem

The invocation telemetry row carries `agent` and `model` but has no record of which confinement policy was in effect or which vendor mechanism the adapter applied, making confinement unobservable after the fact. An operator reviewing telemetry cannot know whether a run under a particular agent saw sandbox restrictions or an unrestricted binding.

## Decisions

- The `InvocationCompletedRecord` telemetry row adds fields recording the resolved confinement policy and the vendor mechanism the adapter applied; both fields are required and non-null in every record.
- A missing or unrecognized policy at invocation time causes the invocation to fail before the record is written (enforced by adapter refusal).
- The resolved policy and mechanism are captured before invoking the adapter and passed to the telemetry sink along with other invocation metadata.
- Plan must decide: the field names for the policy and vendor mechanism in `InvocationCompletedRecord` (e.g., `confinement_policy`/`confinement_vendor_mechanism`, or alternatives).
- Plan must decide: the identifier format for vendor mechanisms in telemetry (e.g., `"codex-workspace-write"`, `"claude-permission-mode"`, `"cursor-force"`, or alternatives).

## Prerequisites

- Confinement policy type and cascade exist (delivered by: config-confinement-policy-type-and-cascade)
- Adapters translate the policy and expose the applied vendor mechanism (delivered by: adapter-confinement-translation-and-refusal)

## Acceptance criteria

- [ ] `execute.test.ts`: a test proves each invocation records its resolved confinement policy (e.g., `"sandbox"`) and the vendor mechanism applied (e.g., `"codex-workspace-write"`) in `InvocationCompletedRecord`'s corresponding fields; it fails while no such fields exist.
- [ ] Same file: the test covers multiple adapters and policy values to show the field is populated across different bindings.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:shared` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Reading invocation telemetry — show how to identify and verify confinement policy from telemetry fields.

## Primary implementation surface

- `shared/invocation/execute.ts` (`InvocationCompletedRecord` schema)
- Invocation calling sites in `v2/src/execution/` that record telemetry (e.g., write-loop invocation code, step-runner).
