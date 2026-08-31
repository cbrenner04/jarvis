---
name: route-external-implement-spec-trees
---

# Route external implement spec trees

## Primary implementation surface

Execution loop.

## Problem

The linked implement runner currently resolves its index, active subspec, prompt artifact, criteria contract, and index tick relative to the materialized code worktree, so an admitted external tree cannot drive implementation in place.

## Prerequisites

- Shared `projectSafeId` maps registered project keys to the path segment used by git-disabled plan publication under `~/.jarvis/specs/<safeId>/plans/<name>/`.
- Implement CLI admission resolves a registered `plan.commit: false` external plan index to its owning project, preserves its canonical external identity, skips target-base membership for that tree, and completes preflight without materializing finished work.

## Decision ledger

- Resolve linked routing, pinned re-reads, acceptance-criteria checks, blocker writes, and index ticks against the admitted external tree root; rules out resolving any spec file through the code worktree.
- Keep agent cwd, code edits, commits, draft PR publication, gates, review, and shrink on the ordinary worktree from `--base`; rules out turning the external plan workspace into the implementation worktree.
- Give implement invocations the minimum admitted external-tree filesystem access needed to read and tick the active subspec while retaining the code worktree as cwd; rules out granting arbitrary Jarvis-home access or relying on sandbox prompts that cannot be approved non-interactively.
- Keep the completed external tree readable but non-editable to review and shrink roles; rules out review-time criteria or index mutation.
- Exclude external spec bytes and ticks from Git staging, completion commits, dirty-worktree checks, diff allowlists, and PR numstat; rules out committing external artifacts through symlinks or copied shadows.
- Preserve ordinary in-repo linked-index behavior through the same runner contract; rules out an external-only fork of implement execution.

## Acceptance criteria

- [ ] An execution regression test routes an external index to its first criteria-incomplete subspec, exposes that active subspec to the implement prompt, and fails against the pre-fix worktree-relative lookup.
- [ ] The implement invocation can read and tick the admitted external subspec while its cwd and code edits remain in the materialized worktree; adapter argument coverage pins bounded external-directory access where the agent CLI requires it.
- [ ] Completion re-reads the pinned external subspec, writes its index checkbox to the external index, advances through later external links, and leaves sibling routing safeguards unchanged.
- [ ] Review and shrink receive the completed external spec context without gaining a path that permits spec mutation.
- [ ] A Git fixture proves the implementation branch contains ordinary code changes and no external spec files, copied shadows, symlinks, or spec-tick commits.
- [ ] Existing in-repo linked routing, completion, review, shrink, and publication tests stay green.
- [ ] `bun run typecheck` and every test surface required by touched `shared/**` and `v2/**` files pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — define the split external-spec/code-worktree execution boundary and linked routing lifecycle.
- `v2/docs/write-behavior.md` — define prompt access, criteria/index writes, review/shrink read-only behavior, and Git exclusion for external specs.
- `v2/docs/v1-behaviors.md` — record v2 parity with v1 external-spec in-place routing while naming any adapter-access difference that remains observable.

## Out of scope

- Changing code publication, gate order, review policy, or v1 execution.
