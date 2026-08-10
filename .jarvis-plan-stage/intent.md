---
name: plan-draft-rejects-unsatisfiable-keystone
---

# Plan draft refuses a keystone criterion no directive can ever satisfy

## Problem

Once the implement can author and link a keystone directive itself, the remaining failure mode is a keystone criterion the implement can never satisfy because the criterion text names no pin: prose-only checkpoints such as "Mutation checkpoint: inverting the undated-row ordering guard makes the scoped test fail" carry neither a pinning file nor an enclosing test title, so no authored directive can link to them. Today plan draft admits these and the cost lands on the implement as a terminal `contract_miss`.

## Behavior

Plan draft refuses a draft whose keystone criterion is textually unsatisfiable — it carries neither a literal `// @mutate` directive nor a pin reference (backticked pinning file plus enclosing test title) the implement could author against — with a message naming the offending criterion. Admissibility is judged from the criterion text alone: no on-disk resolution of the named file or test title, since the pinning test routinely does not exist at plan time (the on-disk enclosing-test gate of #2706 was reverted for false-positiving new tests in existing files). A keystone criterion naming a pin, with or without a literal directive, is admitted.

## Prerequisites

- A ticked keystone criterion naming a pinning file and enclosing test title is satisfied by the `// @mutate` directive the implement lands in that test, including when the plan created the file.
- A keystone ticked with no directive anywhere in the enclosing test still fails implement completion.
- Plan draft validates the drafted spec directory and can refuse it with a named reason.

## Documentation updates

- `v2/docs/workflow-runner.md` — the plan-admission rule for keystone criteria and what makes one satisfiable.
- `v1/docs/spec-guidance.md` — keystone criteria must name a pin; prose-only checkpoints are refused at draft.
- `v2/docs/v1-behaviors.md` — record the changed plan-draft admission behavior.
