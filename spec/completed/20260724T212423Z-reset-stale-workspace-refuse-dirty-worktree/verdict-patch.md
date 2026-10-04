Verifying implementation against the spec and advocate summary before issuing the verdict.


## Adjudicator verdict — `reset-stale-workspace-refuse-dirty-worktree`

### Required outcomes (actuator must address before merge)

1. **Non-empty porcelain must never be treated as clean**  
   When `git status --porcelain --untracked-files=all` returns one or more non-blank lines but path extraction yields no paths, the listing result must not be `{ status: "clean" }`. The subspec defines dirty as any non-empty porcelain (including submodule/conflict or unparseable line shapes) and requires fail-closed behavior when state cannot be listed safely. Implicit stale reset must refuse with a clear `reason` and must not call `performAbandonmentSteps`. Add or extend tests so this case fails if the gate is bypassed.

2. **`resetStaleWorkspace` seam test must cover modified tracked files**  
   The subspec checklist and acceptance criteria require `cleanup.test.ts` coverage at the `resetStaleWorkspace` boundary for both uncommitted tracked changes and untracked paths. The test titled for tracked changes must dirty the tree by changing a file already under version control in the managed worktree (not by adding a new untracked path, which duplicates the untracked case). Assertions must still expect `{ status: "refused", reason }` with the path named, recovery guidance, and no retirement side effects.

### Rationale

Item 1 is a safety regression: the current `paths.length === 0` branch after non-empty porcelain contradicts “non-empty porcelain = dirty” and can allow abandonment when git reports dirty state the parser does not understand. Item 2 is spec fidelity and regression value: the seam tests are the contract for implement/plan via `maybeResetStaleWorkspace`; mislabeled setup weakens the tracked path without adding distinct coverage.

### Not required for this pass

Gate order, `reason`-only refusal on the cleanup seam with workflow stderr wrapping, thrown `git status` fail-closed, guard inversion via `enforceDirtyWorktreeGate` / `staleResetDirtyWorktreeGateReason`, preserved `jarvis cleanup --abandon` behavior, single implement workflow regression, and operator runbook / `v1-behaviors.md` updates for implement and plan meet the completed subspec. Optional hardening (assert empty `io.stderr` on `resetStaleWorkspace` refusal, fuller recovery strings in `workflow.test.ts`, unified listing-failure copy, shared porcelain parser with other harness gates) is not blocking merge once items 1–2 are satisfied.