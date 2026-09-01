1. Enforce external-spec immutability during shrink and all implement-review modes, including bindings with ambient or `danger-full-access` filesystem access. Their mutation scope must remain the code worktree; external criteria/index bytes must remain unchanged, while the harness-owned verdict artifact may still be written. Do not expose an absolute external subspec as a fallback mutation allowlist. Required by subspec `03`’s read-only boundary.

2. Preserve external-spec Git exclusion throughout shrink. Shrink must retain the admitted external identity for staging, completion commits, dirty-worktree checks, and publication without granting the adapter write access. Required by subspec `04`; otherwise shrink-created spec shadows can enter the branch.

3. Persist and restore `externalPlanSpec` and authoritative `specReadRoot` across workflow snapshots and every recovery/finalization path. Recovered commits, dirty checks, publication, and review-mutation handling must apply the same external-tree boundary as the original run. Required by subspec `00`’s replay contract and subspec `04`’s Git guarantees.

4. Root `SPEC_TREE` labels under `specReadRoot` for both light and debate review, as already required for shrink. Review prompts must not contain worktree-relative `../…` labels for external files. Required by subspec `03` and the documented prompt semantics.

5. Exclude copied external-spec artifacts from every Git-facing surface regardless of where the copy is placed within the worktree, while preserving legitimate repository files. Current matching only detects copies at corresponding relative paths, which does not satisfy subspec `04`’s prohibition on copied shadows.
