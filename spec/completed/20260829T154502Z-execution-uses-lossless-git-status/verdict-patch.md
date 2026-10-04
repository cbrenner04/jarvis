Reviewing the implementation, tests, and docs against subspec 02 acceptance criteria.
## Verdict

### 1. Reconcile contradictory operator docs for the dirty-worktree contract

**Required:** `v2/docs/workflow-runner.md` and `v2/docs/write-behavior.md` must no longer describe the no-`commitSha` dirty gate or `getUncommittedPaths` as porcelain-based. They currently contradict the authoritative contract recorded in `v2/docs/v1-behaviors.md` (lossless `getGitStatusInventory` current paths, materialized `node_modules` exclusion, fail-soft `[]` on inspection failure, nested untracked files as exact paths).

**Rationale:** Subspec 02 correctly updated its declared durable home (`v1-behaviors.md`), but `documentation-standard.md` requires one durable home and forbids contradictory duplication. Operators reading `workflow-runner.md` (lines describing `getUncommittedPaths` and the publication-tail dirty check) or `write-behavior.md` (no-`commitSha` dirty gate) still see porcelain semantics that the implementation no longer uses. Cross-link or trim those passages to match `v1-behaviors.md`; do not reintroduce a second full contract.

---

No other adversary findings require actuator changes for subspec 02:

- **Unusual paths:** The acceptance criterion scopes the guarantee to exact path values at the inventory boundary and explicitly disclaims delimiter/serialization claims; pinning via `getUncommittedPaths` in the named test satisfies that contract. Re-asserting unusual paths inside `completionCommitError` is not required.
- **Workflow completion/resume coverage:** All workflow call sites use the same exported helper with no call-site-specific projection; the named integration test adequately pins lossless failure and fail-soft behavior. The test name is spec-mandated; renaming is not required.
- **Fail-soft on inspection failure, lossy comma-joined errors, ready-gate diagnostic text, `cleanup.ts` porcelain, missing injected seam, index bookkeeping:** Spec-intended, out of subspec 02 scope, or already pinned elsewhere.