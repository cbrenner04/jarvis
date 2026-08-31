# Preflight external plan tree completeness

`validateImplementSpecTreeCompletion` and linked-index routing preflight currently treat `projectRoot` as the spec read root, so external linked subspecs under `~/.jarvis/specs/...` misclassify as `implement.link_out_of_tree` or never reach `implement.already_complete` before worktree materialization; `resolveImplementRecoveryRequest` applies the same wrong read root before daemon contact.

## Decisions

- Read admitted external plan completeness from `specReadRoot` (the external `plans/<name>/` directory), not `projectRoot`; rules out resolving linked subspec paths relative to the code checkout.
- Apply the same read-root predicate in `buildImplementWorkflowSteps` and `resolveImplementRecoveryRequest` using `absoluteSpecPath` plus `specReadRoot`; rules out a complete external tree missing the recovery fast path.
- Return `implement.already_complete` during `buildImplementWorkflowSteps` before `loadWorkflowSteps`, worktree materialization, daemon contact, agent invocation, or run-row creation when every non-human-only criterion in the external tree is checked; rules out creating infrastructure for finished work.
- Keep the existing in-repo completeness predicate and human-only handling unchanged for non-external launches; rules out altering repository-local preflight semantics.

## Tasks

- Thread `specReadRoot` from `ImplementSpecIdentity` into `validateImplementSpecTreeCompletion` and `validateLinkedIndexRouting` call sites inside `buildImplementWorkflowSteps` and `resolveImplementRecoveryRequest`.
- Ensure linked subspec paths resolve beside the external `index.md` and no longer compare against the registered project root.
- Add a regression test that stubs or spies `loadWorkflowSteps` to prove a fully checked external tree fails before it is invoked.
- Add a recovery-path regression reachable on the pre-fix `resolveImplementRecoveryRequest` call site.

## Acceptance criteria

- [ ] `implement-workflow-steps.test.ts` returns `implement.already_complete` for a fully checked external plan tree before `loadWorkflowSteps` is invoked; it fails against the pre-fix code that resolves completeness relative to the registered project root.
- [ ] `workflow.test.ts` or `implement-workflow-steps.test.ts` exercises `resolveImplementRecoveryRequest` for a fully checked external plan tree using `specReadRoot` instead of `projectRoot`; it fails against the pre-fix recovery call site that passes `identity.projectRoot` into `validateImplementSpecTreeCompletion`.

## Documentation updates

- `v2/docs/workflow-runner.md` — document external-plan preflight completeness timing and read root for build and recovery paths (cross-link operator runbook for the standalone command); note admission/preflight scope only.
