# External subspec write access and adapter read dirs

The write loop re-reads `spec.criteria-ticked` and injects the active subspec from `resolveInWorktree(worktreePath, expectedArtifactPath)`, and production agent bindings never receive bounded read access to the admitted external tree, so agents cannot tick external acceptance criteria while editing code in the worktree.

## Decisions

- Treat an absolute `expectedArtifactPath` outside the worktree as the criteria contract and prompt artifact path without joining it under `worktreePath`; rules out worktree-relative resolution that drops external subspec edits.
- Pass exactly `specReadRoot` (the admitted `plans/<name>/` directory) as adapter `additionalReadDirs` for implement write iterations when `externalPlanSpec: true`; rules out granting all of `~/.jarvis` or relying on interactive sandbox approvals.
- External implement grants only admitted `specReadRoot` as `additionalReadDirs`, not v1 configured project sibling dirs; rules out widening adapter access to match v1 patch sibling enumeration.
- Wire `additionalReadDirs` through the shared invocation binding layer for agents that support bounded read dirs (at minimum `claude` and `codex`, matching v1 patch behavior); rules out a v2-only prompt workaround that cannot be approved non-interactively.
- Omit `additionalReadDirs` for ordinary in-repo implement runs; rules out changing adapter argv for worktree-local specs.
- Deferred to first consumer: `cursor` / `opencode` external read-dir argv parity beyond what their CLIs expose today — pin when those agents must run external implement in production.

## Tasks

- Extend `InvocationBinding.invoke` (or the write-loop call site) to accept optional `additionalReadDirs` and thread it from `executeWrite` / `executeWriteLoop` when the active step carries `specReadRoot` + `externalPlanSpec`.
- Update shared agent runners (`shared/invocation/agents.ts`) to honor `additionalReadDirs` on supported adapters.
- Adjust `executeDefaultWrite` / `patch.prompt.body` criteria checks and active-subspec injection to read absolute external artifact paths directly.
- Route `appendBlockerToSpec` / `write.blocker-text` to the external active subspec when `externalPlanSpec: true` and `expectedArtifactPath` is absolute.
- Add a write-loop or workflow regression with a fake binding that records `additionalReadDirs` and mutates the external subspec file while `cwd` remains the worktree.
- Add a write-loop regression that appends a harness blocker to the external active subspec on `contract_miss` while `cwd` remains the worktree.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` regression drives an implement write with `externalPlanSpec: true`, records adapter `additionalReadDirs` equal to the admitted `specReadRoot`, ticks a criterion on the external subspec from the worktree `cwd`, and fails against the pre-fix binding that omits external read access.
- [ ] `v2/src/execution/write-loop.test.ts` regression drives an external implement `contract_miss`, asserts `appendBlockerToSpec` / `write.blocker-text` targets the external active subspec when `expectedArtifactPath` is absolute, and fails while `00` still emits worktree-relative blocker paths.
- [ ] `v2/src/execution/write.test.ts` `patch.prompt.body` criteria and active-subspec coverage stays green for in-repo artifacts.
- [ ] `shared/invocation/agents.test.ts` stays green.
- [ ] `shared/invocation/execute.test.ts` stays green.

## Documentation updates

- None in this subspec; `05` owns operator-facing docs.
