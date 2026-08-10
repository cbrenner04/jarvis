---
name: keystone-criteria-need-linkable-mutate-directives
---

# Keystone criteria must carry a linkable @mutate directive the implement can satisfy

## Problem

The implement `spec.criteria-ticked` contract refuses to tick a keystone/mutation-checkpoint criterion unless a `// @mutate <path> "<original>" -> "<replacement>"` directive is linked to it (`Unlinked keystone checkpoints (no directive linked on the named pin)`). When a plan phrases the checkpoint in prose only — e.g. "Mutation checkpoint: inverting the undated-row ordering guard makes the scoped test fail" — with no literal directive, the implement blocks `contract_miss` even though the code and tests are written and the suite passes. Observed 2026-08-09 on `tui-attention-segment-rows` (plan #2774): the implement completed subspec 00 (code + tests on disk, all functional criteria met) and blocked twice on this contract; the entry run is non-resumable, so the whole spec strands. This is aggravated for greenfield subspecs whose target file does not exist at plan time, so the plan cannot name the exact original text to mutate. In the same session, codex-authored plans (wire, status-line) embedded literal `// @mutate` directives and passed the contract; the claude-authored plan did not — so plan-agent variance decides whether a spec is implementable.

## Decisions

- A keystone/mutation-checkpoint acceptance criterion is only admissible when it is satisfiable: either the plan emits a concrete `// @mutate` directive, or the criterion is expressed so the implement can author and link one from the criterion text — rules out prose-only checkpoints that no directive can satisfy.
- Close the greenfield gap: a keystone criterion whose mutation targets a file the plan is creating must still be linkable after the implement writes that file — the contract keys off the directive the implement lands in the enclosing test, not off a plan-time literal — rules out requiring the plan to name text that does not yet exist.
- Keep the guarantee: a genuinely unlinked keystone (agent ticked without adding any directive) still fails the contract — rules out weakening the check into a no-op.
- Scope to admissibility + link resolution; no change to how a linked mutation is verified once present — rules out reworking the mutation verifier.

## Acceptance criteria

- [ ] A plan whose keystone criterion carries only prose (no literal `// @mutate`) is either rejected at plan admission with a message naming the unsatisfiable criterion, or is accepted and its implement can author-and-link a directive from the criterion text and tick it; a regression pins whichever path is chosen and fails against today's unconditional `contract_miss`.
- [ ] A keystone criterion targeting a plan-created (greenfield) file is tickable once the implement writes that file and lands the linked `// @mutate` directive in the enclosing test; a regression drives a greenfield subspec through implement to a ticked keystone.
- [ ] A keystone criterion ticked with no directive anywhere in the enclosing test still fails the contract; a regression pins the negative case.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — record that keystone criteria need a linkable `// @mutate` directive, how greenfield keystones resolve, and the recovery when an implement strands on `Unlinked keystone checkpoints`.
- `v2/docs/workflow-runner.md` — note the plan-admission / implement-link contract for keystone criteria.
