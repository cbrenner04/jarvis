# Resolve fan-out plan input by branch key

Branch-scoped plan resolution currently verifies every sibling ready-intent in `downstreamInputs`, so a lane whose ready-intent was consumed into its own landed spec tree blocks an untouched approved lane before dispatch.

Seed alignment: operator-runbook update omitted — no durable hand-drive workaround prose exists in `v2/docs/operator-runbook.md` (workaround lived in seeds/reports only).

Ordered: `00` branch-scoped fan-out plan resolution in `pipeline-stage-resolve.ts`; `01`–`02` document landed behavior.

- [ ] [00 - Branch-scoped fan-out plan resolution](./00-branch-scoped-fan-out-plan-resolution.md)
- [ ] [01 - Document pipeline-execution fan-out plan resolution](./01-document-pipeline-execution-fan-out-plan-resolution.md)
- [ ] [02 - Document v1-behaviors fan-out plan resolution](./02-document-v1-behaviors-fan-out-plan-resolution.md)
