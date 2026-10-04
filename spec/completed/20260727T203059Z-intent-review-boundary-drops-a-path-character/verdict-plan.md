Validating key claims in the codebase before issuing the verdict.


## Adjudicator verdict — required refinements

### 1. Workflow happy-path acceptance must pin a git-backed, first-line ` M` scenario

The new “tracked edit under staging completes review” criterion must state observable fixture requirements, not only the outcome. An implementer can satisfy the words today with the same patterns as `stageReviewedIntent` plus temp dirs (no real git porcelain, or only new untracked files under staging), which never exercises whole-buffer trim or first-line unstaged tracked ordering.

**Required outcome:** The criterion (and task checklist, if it stays vague) must require a git-initialized split workspace where staging content is already tracked before review, the actuator performs an **in-place** content change on a tracked path under the staging directory (not “create a new file”), and review completes without a boundary violation. Point to the existing git harness shape used for full reviewed-intent flows (e.g. `createIntentWorktreeHarness` / `twoFileIntentWorkflow`) as the intended model, and distinguish it from non-git reviewed-intent tests.

**Rationale:** Matches the intent’s production failure mode (split commits staging → actuator’s edit is `<space>M` on the first porcelain line). Pairs with guard inversion: a workflow test that does not depend on porcelain parsing would stay green when the parse fix is reverted, making the inversion AC unsatisfiable.

---

### 2. Documentation acceptance must match where operators actually see the workaround

The documentation AC currently requires removing an intent-review porcelain workaround from `v2/docs/operator-runbook.md`. In the repo, `--review-passes 0` in the runbook is documented as normal opt-out, not as a porcelain false-positive workaround. The workaround for this bug is recorded in `v2/spec/implement-queue.md` (and in the intent problem text).

**Required outcome:** Documentation acceptance (and matching intent documentation bullets) must (a) update or retire the misleading workaround wherever it lives for this bug (at minimum `v2/spec/implement-queue.md`), and (b) add runbook wording that boundary violation messages list repo-relative paths verbatim. Do not rely on “remove runbook workaround” alone—that can be ticked without fixing operator-facing text.

**Rationale:** Spec guidance treats documentation as part of the work; vacuous or mis-targeted doc ACs let the run complete while the queue still tells operators to use `--review-passes 0` for this defect.

---

### 3. Align “no path-field trim” decisions with what acceptance proves

Decisions forbid per-line `trimStart`/`trim()` on the path field after status columns. Current `gitStatusPaths` still uses `line.slice(3).trim()`. Fixing only whole-buffer `.trim()` fixes the reported bug but may leave behavior that contradicts the written decisions.

**Required outcome:** Either narrow the decision text to what this change actually guarantees (no whole-buffer trim; line splitting rules only), **or** add acceptance that path extraction does not strip leading path characters via path-field trim (mocked porcelain is enough). Do not leave decisions and implementation contract in tension.

**Rationale:** Intent decisions explicitly rule out per-line trim on the path field; without alignment, an implementer can tick parsing ACs while leaving `.trim()` on the path segment.

---

### 4. Explicitly exempt or skip `v2/docs/v1-behaviors.md` (minor)

Spec guidance calls for updating the v1 parity catalog when **existing functionality** changes. This work restores intended boundary behavior after a parse bug; policy and allowlists are unchanged.

**Required outcome:** One explicit note in documentation updates: skip `v1-behaviors.md` (bug restore, no contract change), **or** a minimal catalog entry if boundary message wording is considered part of the documented surface.

**Rationale:** Avoids implementer guesswork and unnecessary scope creep.

---

### Not required (no spec change)

- **Outside-staging violation AC** failing pre-fix: acceptable as integration/messaging coverage; failing-test duty is carried by first-line ` M` unit test, workflow happy path, and guard inversion—not every AC must fail on baseline.
- **Mixed `??` + `A` unit AC:** intentional breadth from intent; guard inversion correctly scoped to the defect-pinning tests.
- **Manual guard inversion AC:** consistent with repo convention (named checkpoint, not CI revert job).
- **Other porcelain call sites:** in-scope bound to `review-intent-enforcement.ts` is fine; optional one-line “no harness-wide helper in this spec” in decisions only if you want anti-creep clarity—not mandatory.
- **Subspec split:** single atomic subspec remains appropriate; no index split required.