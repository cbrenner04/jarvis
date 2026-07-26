Verifying key gaps cited in the advocate response against the implementation.
## Adjudicator verdict — required outcomes

### 1. Subspec 00: materialization guard-inversion must match the stale-tracking scenario

The `external-worktree.test.ts` case named for stale `origin/<branch>` must set up **both**: `ls-remote` reports no head **and** local `rev-parse` on `origin/<branch>` would still succeed (stale tracking ref). Today an empty fake repo only proves “no remote head,” which `shared/git.test.ts` already covers.

**Outcome:** That test must fail if `branchExistsOnOriginAsync` is reverted to `rev-parse`-only or if materialization chooses `git branch <name> origin/<name>` while only a stale tracking ref exists.

---

### 2. Subspec 01: prune-step failure must abort retirement (tested)

Subspec 01 requires abort when deleting a still-present `refs/remotes/origin/<branch>` fails, same class as other retirement failures.

**Outcome:** Automated coverage forces the prune subprocess to fail and expects retirement to stop at the remote-tracking-ref step with partial `destroyed` artifacts and no successful completion of later steps (e.g. PR close) as if prune succeeded.

---

### 3. Subspec 01: guard-inversion must not allow false “pruned” success

The cleanup guard-inversion case uses a runner that no-ops `update-ref -d` while the real tracking ref remains; production still treats the step as success and can emit prune stdout / set `destroyed.remoteTrackingRef`.

**Outcome:** When the tracking ref still resolves after the prune step, retirement must **not** complete as full success with prune reporting, **or** production must verify removal after `update-ref -d` and fail closed if the ref remains. Tests must assert the chosen contract (reporting honesty or abort), not `status: "reset"` with a surviving ref and implied prune success.

---

### 4. Operator UX: `jarvis cleanup --abandon` preview vs execute vs runbook

Runbook and execute path include pruning a resolving `origin/<branch>` after remote delete; the abandon **preview** (before confirm) still lists only worktree, local delete, remote delete, and PR close.

**Outcome:** Preview text matches the documented retirement order and what `performAbandonmentSteps` runs—include a prune line when a stale tracking ref would be removed—or runbook/preview docs are corrected so operators are not misled. Prefer aligning preview with execute.

---

### 5. Spec housekeeping (same change set, no behavior debate)

- Subspec `00-…` **task checklist** boxes remain `[ ]` while implementation and ACs are done; tick tasks when Jarvis/spec workflow allows, so the subspec matches landed work.
- `intent.md` acceptance criteria remain unchecked though index/subspec ACs are complete; mirror completion there if intent is treated as contract-of-record.

---

### Not required before merge (document only if follow-up)

- **Positive remote materialization in mocks:** Subspec 00 preservation AC is “`external worktree helper` stays green”; mocks do not currently assert `git branch … origin/…` when `remoteBranches` has the branch. Intent AC #2 is satisfied by unchanged production logic plus e2e/workflow coverage of the stale path; adding a mock case with `remoteBranches` seeded is **recommended** when touching `external-worktree.test.ts` for outcome (1), not a separate blocker.
- **v1 external-spec cleanup leaving a tracking ref** when remote delete is skipped early: outside subspec 01’s `performAbandonmentSteps` scope; optional one-line note in durable docs if operators use v1 external re-run cleanup, not an actuator fix for this patch.
- **Stale v1 test comments** (~fetch framing): low-severity maintainer hygiene only.

---

### Rationale

Core fix (`ls-remote` fail-closed, v2 retirement prune + reporting, workflow re-dispatch e2e) matches the spec and intent. Remaining gaps are **AC-shaped test holes** (stale-tracking materialization naming, prune abort, honest prune reporting) and **operator-facing preview drift**—not design rework. Closing them prevents regressions that reintroduce the 2026-07-25 failure mode or silent false prune success without weakening the deliberate preservation framing for happy-path remote resume.