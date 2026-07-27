# Adjudicator verdict — required refinements

## Upheld issues

The two-subspec structure, ordering (00 then 01), and core fix (authoritative `ls-remote` + retirement-time prune/report) are sound and match the intent. The draft still has gaps in blast-radius ownership, acceptance-criteria shape, implementer-facing test harness work, and a few behavioral contracts left implicit.

---

## Required refinements

1. **Subspec 00 — shared helper blast radius (v1)**  
   The spec must state explicitly that changing `branchExistsOnOrigin` / `branchExistsOnOriginAsync` in `shared/git.ts` changes v1 worktree/base and remote-existence behavior, not only v2 external materialization. It must record a clear product decision: v1 accepts `ls-remote` with fail-closed false, or v1 stops using this helper for those paths and keeps a different contract. Acceptance criteria must include scoped v1 preservation (named tests or describe blocks, e.g. in `v1/test/run.test.ts`), not only new shared/v2 tests. Documentation updates for `v2/docs/v1-behaviors.md` must cover v1 (and shared-helper) semantics, not only “v2 external worktree materialization.”

2. **Subspec 00 — failing-test AC for the positive remote path**  
   Per spec guidance, an AC that claims `external-worktree.test.ts` “materializes from `origin/<branch>` when the bare remote has the branch” is not a valid *new-behavior* failing-test AC: pre-fix code already passes that case. Rewrite that outcome as **preservation** (cite existing test names that must stay green). Keep failing-test ACs on stale tracking ref → false, guard inversion → `--base` path, and related regression cases only.

3. **Subspec 00 — fail-closed `ls-remote` as an operator-visible trade**  
   The decision to treat `ls-remote` failure or empty output as “absent on remote” (no `rev-parse` fallback) must be stated in Decisions and reflected in operator-facing docs: offline/auth/network failure during materialization can treat an actually-existing remote branch as absent and bias toward `--base`. Contrast with other harness paths that skip or soften remote checks on failure, so the choice is deliberate, not accidental.

4. **Subspec 00 — test harness and API docs tasks**  
   Tasks must require updating git fakes/shims used by `external-worktree.test.ts` (and any other suites that stub remoteness via `rev-parse` on `origin/<branch>`) so they emulate `ls-remote --heads` behavior; without this, implementers will break existing cases when production moves to `ls-remote`. Tasks must also update `shared/git.ts` module/JSDoc that still describes fetch-then-local-tracking as the contract.

5. **Subspec 00 — scope of “exists on origin”**  
   Clarify that the preserved “materialize from remote” path assumes fixture/setup consistent with today’s happy path (local tracking ref and/or local branch present). Explicitly mark “remote exists per `ls-remote` but never fetched locally” / fetch-before-branch as **out of scope** unless a separate intent owns it, so 00 does not silently widen materialization behavior.

6. **Subspec 00 — `ls-remote` matching contract (lightweight)**  
   Add a decision that defines how branch name is matched in `ls-remote` output (e.g. `refs/heads/<name>`, exact name, no wildcards) to prevent implementer drift; keep it minimal for fixture branch names.

7. **Subspec 01 — prune failure semantics**  
   Decide and document whether failure to delete a still-present `refs/remotes/origin/<branch>` during `performAbandonmentSteps` **aborts** retirement (aligned with worktree/local-branch failures) or **logs and continues** (aligned with best-effort `worktree prune`). Acceptance or task checklist must match that choice.

8. **Subspec 01 — problem statement alignment**  
   After 00, tie the prune problem to intent (“no local ref, including tracking, may resolve the run branch after reset”) and stale local resolution, not to materialization still using `rev-parse` as the primary narrative.

9. **Subspec 01 — `--abandon` preservation**  
   Because prune lives in shared `performAbandonmentSteps`, add a preservation AC citing existing abandon-order coverage (e.g. `cleanup.test.ts` abandon step ordering) and, if reporting changes, that abandon/reset paths remain correct when a tracking ref exists.

10. **Subspec 01 — intent reporting on success paths**  
    Intent requires reset to report what was removed, including the remote-tracking ref. Keep ACs that assert destroyed-artifact records and/or stdout from abandonment/reset in `cleanup.test.ts`. Optionally clarify in the spec that on successful re-dispatch, per-step abandonment **stdout** (not only stderr `formatDestroyedArtifactsSummary` on failure) satisfies “reports what it removed,” so implementers do not chase workflow stderr on the happy path unless product wants that too.

11. **Subspec 01 — plan vs implement e2e scope**  
    State whether plan re-run is in scope via the same `resetStaleWorkspace` / retirement chain (implement-only workflow e2e is sufficient) or require an additional named regression; align with intent’s “re-dispatch after preflight reset” wording.

12. **`intent.md` — Prerequisites**  
    Reword prerequisites as infrastructure dependencies observable on main (e.g. reset calls `performAbandonmentSteps`; materialization calls `branchExistsOnOriginAsync` before `--base`), without implying the remoteness check is already correct.

---

## Rationale (brief)

- **Intent** requires correct re-dispatch from `--base`, preserved true-remote materialization, and reset reporting including the tracking ref; a shared-helper change without v1 ownership and parity docs violates spec guidance for behavior changes and risks silent v1 regression.  
- **Spec guidance** requires valid failing-test ACs for new runtime behavior and preservation ACs that cite tests for unchanged paths; the current positive-path AC in 00 violates that.  
- **Implementability**: fakes, prune failure policy, and `ls-remote` parsing scope reduce guesswork and wrong retirement behavior on `--abandon` and success-path operator visibility.

---

## Not required

- Splitting 00/01 into more subspecs.  
- Mandatory second plan workflow e2e if 01 explicitly documents plan coverage through shared reset.  
- Runbook cross-link from 01 to 00 beyond optional clarity (doc split between subspecs is acceptable).