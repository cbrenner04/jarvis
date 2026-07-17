# Validate implement spec against the base ref

An implement launch can resolve a spec from the operator's cwd even though the requested base cannot populate that project-relative path in a fresh run worktree. Reject that launch before it consumes daemon or agent resources.

## Decisions

- Validate the resolved project-relative spec path in `baseRef` before linked-index routing or workflow-step loading; rules out filesystem existence as proof that the future worktree contains the spec.
- Return a CLI-time argument error naming the spec path and base ref; rules out a later daemon `harness_failure` after worktree or agent activity.

## Out of scope

- Routing-read diagnostics after a base-tracked spec later becomes missing or unreadable.
- Absolute `--spec` support policy.

## Tasks

- Add base-ref checkout reachability validation to implement launch resolution.
- Add focused builder and CLI regression coverage for base-tracked and cwd-visible-only specs.
- Align the durable workflow, operator, and v1-parity docs.

## Documentation updates

- `v2/docs/workflow-runner.md` — document cwd resolution followed by base-ref checkout validation before workflow construction.
- `v2/docs/operator-runbook.md` — replace the temporary project-root launch warning with the shipped preflight rejection and recovery guidance.
- `v2/docs/v1-behaviors.md` — record the changed v2 implement preflight behavior.

## Acceptance criteria

- [x] `jarvis run workflow implement --base <ref> --spec <path>` exits `1` when the cwd-visible spec is absent at its resolved project-relative path in `<ref>`; stderr names the path and base ref, and no daemon contact, worktree creation, or agent invocation occurs.
- [x] `v2/src/execution/implement-workflow-steps.test.ts` includes a real-git regression where a gitignored worktree-local spec exists on disk but not in the base ref; it fails against the pre-fix code and passes after the change.
- [x] A spec tracked at the resolved project-relative path in the requested base continues through implement workflow construction, including launch from a cwd below the registered project root.
- [x] `v2/src/cli.test.ts` verifies the unavailable-from-base error is surfaced before daemon contact.
- [x] `v2/docs/workflow-runner.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` describe the base-ref preflight behavior and no longer direct operators to avoid non-root cwd as a workaround.
