Verifying doc alignment and the cross-worktree spec I/O gap before issuing the verdict.
## Verdict

### 1. Close the chained linked-implement publication gap

**Outcome:** Chained pipeline implement with a spec tree on the prior stage worktree and an implement worktree cut from the repository default branch must have a defined, tested end-to-end contract for where spec-tree mutations land relative to the implement draft PR.

**Why:** Retiring `prior.branch` as publication `baseRef` splits what stacked bases used to unify: routing/preflight now read the plan worktree (`specReadRoot`, absolute `specPath`, `preflightBaseRef`), while completion commits and publication run in the default-branch implement worktree. Index ticks and subspec edits can therefore occur outside the tree that gets committed and published. The added `workflow-runner` / `implement-workflow-steps` changes enable launch and routing but do not lock publication semantics; subspec 03 only guards `baseRef` at the publication boundary. Operators expect implement completion to produce a coherent default-branch PR; unchecked acceptance criteria on a separate worktree violate that unless explicitly designed and documented.

**Acceptance:** Either (a) spec-tree changes made during chained implement are included in implement completion commits against the default-branch worktree (or otherwise appear on the published implement PR), with regression from resolution through real workflow execution, or (b) durable docs and operator guidance explicitly define the split (spec progress stays on prior worktree; implement PR is code-only) and the landing path is verified. Option (a) matches the spec intent to retire stacked PRs and land on main.

---

### 2. Align `daemon-host.md` with the two-ref hand-off model

**Outcome:** The seed/artifact hand-off section must match current behavior: chained plan and implement set publication/worktree `baseRef` to the repository default branch (`getBaseBranch` on admission `cwd`), not `prior.branch`; implement spec-availability preflight uses `prior.branch` on the prior worktree; `prior.branch` remains for rematerialization; legacy publication retarget applies only to in-flight stacked admissions.

**Why:** Line ~480 still states chained implement takes `baseRef` from the prior entry run’s `branch`. That contradicts `pipeline-execution.md`, `operator-runbook.md`, `v1-behaviors.md`, and the implementation. Per `documentation-standard.md`, conflicting architecture docs must not coexist; subspec 03 updated three durable homes but missed the primary daemon hand-off doc.

---

### 3. Align `workflow-runner.md` with chained implement launch semantics

**Outcome:** Document that chained `preflightGitRoot` launches probe spec availability via `preflightBaseRef` (typically `prior.branch`), not publication `baseRef`; document that chained builds may emit absolute `specPath`, set `specReadRoot`, and use absolute `expectedArtifactPath` for linked-index routing when the spec tree lives outside the implement worktree.

**Why:** ~line 45 still says artifact `specPath` stays worktree-relative for pipeline implement; ~line 290 still implies chained preflight gates on publication `baseRef`. Both are stale after subspec 01 and the `implement-workflow-steps` / `workflow-runner` changes. Subspec 01 deferred doc churn to other subspecs; those subspecs did not update this durable home.

---

### Not required in this pass

- Hardcoding `"main"` in test assertions (style; fixtures already separate `prior.branch` from default).
- Restoring `WORKFLOW_PRESET_BUILDERS` on the rematerialization test (spec only required the existing fallback test stay green).
- `preflightBaseRef` for custom implement builders (production path uses preset builders; document or guard only if custom-builder pipelines are supported).
- Updating top-level `intent.md` checkboxes (harness bookkeeping).