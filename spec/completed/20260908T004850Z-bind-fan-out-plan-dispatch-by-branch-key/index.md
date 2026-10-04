# Bind fan-out plan dispatch by branch key

Fan-out execution and recovery join plan `{ results }` to lanes by `branchKeys` index, though resolver output stays paired with intent `downstreamInputs[i]` → `results[i]`, so order divergence or short/mismatched result sets can dispatch a sibling lane's steps or skip without refusal.

Prerequisite: branch-scoped plan resolution in `pipeline-stage-resolve.ts` (`20260907T171555Z-resolve-fan-out-plan-input-by-branch-key`).

Ordered: `00` branch-key result binding in `pipeline-execution.ts` and `pipeline-stage-recovery.ts`; `01`–`03` document landed behavior.

- [x] [00 - Branch-key fan-out plan result binding](./00-branch-key-fan-out-plan-result-binding.md)
- [x] [01 - Document pipeline-execution fan-out plan dispatch binding](./01-document-pipeline-execution-fan-out-plan-dispatch-binding.md)
- [x] [02 - Document operator-runbook serial-approval workaround retirement](./02-document-operator-runbook-serial-approval-workaround-retirement.md)
- [x] [03 - Document v1-behaviors fan-out plan dispatch binding](./03-document-v1-behaviors-fan-out-plan-dispatch-binding.md)
