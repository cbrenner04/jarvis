# Document external plan implement admission

Operator and parity docs must record the external-plan implement admission contract landed in `00`–`03` without duplicating the full workflow-runner reference or implying end-to-end agent-loop execution support.

## Decisions

- Place the normative admission contract in `v2/docs/workflow-runner.md` and keep `v2/docs/operator-runbook.md` to command examples plus cross-links; rules out duplicating the full contract in the runbook.
- Runbook and workflow-runner prose cover admission through build preflight and stale-reset orchestration only; cross-link the sibling execution-routing intent for agent-loop `resolveInWorktree` behavior; rules out standalone external implement reading as full-loop support.
- Record the resulting v2 behavior in `v2/docs/v1-behaviors.md` without changing v1; rules out v1 code or doc edits in this spec.
- Deferred to first consumer: `reviewPasses > 0` verdict-path behavior for external specs outside the code worktree — pin when the execution intent lands.

## Tasks

- Align `v2/docs/workflow-runner.md` with the final admission, `planSource` publication predicate, identity fields, base-ref bypass, completeness preflight (build + recovery), external read root, and stale-reset landed-criteria skip from `00`–`03`.
- Add a standalone external-plan implement example (projects whose `planSource` publishes to `~/.jarvis/specs/<safeId>/plans/`) and preflight-through-stale-reset notes to `v2/docs/operator-runbook.md` with cross-links to `workflow-runner.md` and the execution-routing sibling intent.
- Add a v2 additive `v1-behaviors.md` entry for external-plan implement admission through stale-reset preflight.

## Acceptance criteria

- [ ] `v2/docs/workflow-runner.md` documents external-plan implement admission, `planSource` publication predicate, project ownership, identity fields, canonical path handling, base-ref bypass, preflight completeness (build + recovery), and stale-reset landed-criteria handling consistent with `00`–`03`.
- [ ] `v2/docs/operator-runbook.md` documents the standalone external-plan implement command through admission/preflight/stale-reset success, cross-links `workflow-runner.md` instead of duplicating the contract, and cross-links execution routing for the agent loop instead of implying full-loop support.
- [ ] `v2/docs/v1-behaviors.md` records v2 external-plan implement admission through stale-reset preflight without changing v1.

## Documentation updates

- None beyond the acceptance criteria above.
