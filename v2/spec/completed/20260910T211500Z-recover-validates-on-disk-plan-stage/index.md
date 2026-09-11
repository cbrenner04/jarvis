---
name: recover-validates-on-disk-plan-stage
---

# `pipeline recover` validates the operator's on-disk staged tree

`recoverPlanStage` forwards the captured review step to `executeWorkflow`, which runs the review/actuator roles; the actuator redrafts `.jarvis-plan-stage/`, so the operator's correction is overwritten and the reported `plan_stage_invalid` names a file the operator had deleted. Make recovery a pure validate-then-land path over the tree as it sits on disk.

- [x] [00-land-on-disk-stage-without-agent-roles.md](./00-land-on-disk-stage-without-agent-roles.md) — recover lands the staged tree directly instead of re-entering the review/actuator loop
- [x] [01-validate-before-mutating-staged-tree.md](./01-validate-before-mutating-staged-tree.md) — structural refusal happens before the harness-blocker strip touches staged `intent.md`
