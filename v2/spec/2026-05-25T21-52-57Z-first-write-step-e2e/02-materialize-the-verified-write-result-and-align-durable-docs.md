# 02 - Materialize the verified write result and align durable docs

## Decisions

- Materialize the Phase 1 result in a worktree under `~/.jarvis/worktrees`; do not add a retention policy, reuse policy, cleanup UX, or broader lifecycle manager.
- Treat Phase 1 success as asymmetric-both: the agent declares a terminal success token and the runner deterministically verifies the artifact contract before the step passes.
- Keep the first output-contract vocabulary minimal and Phase-1-specific: one declared write artifact plus repository-boundary checks needed to prove the write landed in the worktree correctly.
- Verify the output contract only on terminal success claims; `progress` never triggers verification in this phase because the run stops non-success before any loop exists.
- Fail the step when the agent claims terminal success but the deterministic contract does not pass; do not silently retry and do not infer success from worktree dirtiness alone.
- Keep the contract machine-checkable and inspectable without a metadata sidecar; success must be derivable from the declared artifact and repo state in the worktree.
- Preserve `.jarvis.lock` coexistence as a repository invariant during worktree setup; broader admission and multi-run lock policy stay deferred to Phase 7.
- Keep Phase 1 repo invariants narrow: writes stay inside the materialized worktree, target-repo state outside that worktree is untouched, and the verified artifact path is deterministic.
- Update existing durable docs only where Phase 1 changes their truth: `v2/docs/v2-build-order.md` and `v2/docs/v2-architecture.md`.
- Supersede the current daemon-first interface sequencing in `v2/docs/v2-architecture.md` with the implemented Phase 1 fact: CLI host first, daemon host later in Phase 3.
- Do not add a new Phase 1 usage guide; existing build-order and architecture docs are the durable homes for this behavior and boundary.
- Deferred to first consumer: whether the output-contract vocabulary needs more than one artifact or richer repo predicates — pin when a later step needs them.

## Constraints

- Keep the subspec limited to worktree materialization, deterministic contract enforcement, and required durable doc alignment.
- Do not add durable state, resume markers, transcript archives, or sidecar metadata files to make success inspectable.
- Do not broaden repo lifecycle policy beyond the invariants Phase 1 needs to materialize one verified write result.

## Assumptions

- The target repo is already resolved before this slice runs; this subspec defines the worktree result, not project-discovery UX.
- A single verified artifact is enough to prove the first end-to-end write path; later phases can grow richer contract primitives behind real callers.

## Task checklist

- Define the Phase 1 worktree location and repository invariants before and after the write.
- Define the minimal deterministic output contract for one verified write artifact.
- Define failure behavior for contract mismatches after a terminal success claim.
- Define the required doc updates in `v2/docs/` and keep them limited to the statements Phase 1 makes stale.

## Phase 1 contract and boundary

- Phase 1 materializes the write result in a worktree under `~/.jarvis/worktrees`.
- Phase 1 defers retention policy, worktree reuse, cleanup UX, and broader lifecycle management.
- Worktree setup preserves `.jarvis.lock` coexistence and confines writes to the materialized worktree, leaving the source checkout untouched.
- Phase 1 success is inspectable from worktree and git state alone; no metadata files, SQLite rows, or transcript-derived verification are added for this slice.
- Do not add a new Phase 1 usage guide; durable operator-facing truth for this slice stays in `v2/docs/v2-build-order.md` and `v2/docs/v2-architecture.md`.

## Phase 1 output contract

- The minimal contract is one declared write artifact plus deterministic repository-boundary checks in the materialized worktree.
- Verification runs only on a terminal success claim.
- The step passes only when both conditions hold: the agent emits a terminal success token and deterministic contract verification succeeds.
- A contract mismatch after a terminal success claim is terminal non-success: stop without silent retry.

## Acceptance criteria

- [x] The spec states that Phase 1 materializes results in a worktree under `~/.jarvis/worktrees` and explicitly defers retention, reuse, cleanup, and broader lifecycle policy.
- [x] The spec defines the minimal Phase 1 output contract as one declared write artifact plus the repository-boundary checks needed to verify it deterministically inside the worktree.
- [x] The spec states that Phase 1 passes only when the agent emits a terminal success token and the runner's deterministic contract verification succeeds, and that contract failure after a success claim is terminal non-success without silent retry.
- [x] The spec states that success is inspectable from the worktree and git state alone and that Phase 1 does not add metadata files, SQLite rows, or transcript-derived verification.
- [x] The spec states that worktree setup preserves `.jarvis.lock` coexistence and keeps writes confined to the materialized worktree, leaving the source checkout untouched.
- [x] The spec updates `v2/docs/v2-build-order.md` to reflect the concrete shipped Phase 1 path and updates `v2/docs/v2-architecture.md` to replace daemon-first sequencing with CLI-host-first for Phase 1 while keeping the daemon as a later host.
- [x] The spec does not add a new Phase 1 usage guide or speculative operator doc outside the existing durable homes in `v2/docs/`.

## Documentation updates

- Update `v2/docs/v2-build-order.md` so Phase 1 names the implemented one-shot write path, the worktree-only persistence boundary, the minimal output contract, and quota fallback.
- Update `v2/docs/v2-architecture.md` so the interface sequencing matches Phase 1 reality: CLI host first over a host-agnostic core, daemon host later in Phase 3, and the Phase 1 output-contract/worktree boundary is reflected where the current text would be false.
