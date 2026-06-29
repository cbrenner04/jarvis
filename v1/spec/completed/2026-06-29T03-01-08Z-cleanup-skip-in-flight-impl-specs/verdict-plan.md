## Verdict — required refinements

### 1. Fix ownership key for guards 2 and 3 (blocking)

**Outcome:** Behavior and Decisions must key the open-PR and live patch-worktree guards off the resolved archive `specName` from `resolveSpecArchiveSource` (timestamped basename when the spec dir is timestamped), not `specNameForBranch(plan/<name>)` → stripped `<name>`.

**Rationale:** Patch branches and `.worktree/` dirs use `getSpecName` (timestamped basename). Stripped plan slugs miss `.worktree/<timestamped-basename>/` and open PRs on the implementation branch — the motivating premature-archive bug stays reachable whenever guard 1 passes. Contradicts intent and spec-guidance timestamped plan workflow.

---

### 2. Add timestamped-workflow acceptance coverage (blocking)

**Outcome:** At least one acceptance criterion (and matching test task) for merged `plan/<name>` cleanup while `.worktree/<timestamped-basename>/` exists and while an open PR exists on branch `<timestamped-basename>`; skip logs name the timestamped slug.

**Rationale:** Current ACs only exercise untimestamped `<name>` paths. Existing archive tests cover timestamped archive targets with plan worktrees only — they would not catch the slug bug. Spec guidance treats timestamped dirs as the dominant shape.

---

### 3. Pin spec-completion input path (required)

**Outcome:** Behavior or Decisions must state guard 1 reads completion from the resolved archive source directory: `index.md` when present (index-routed, including linked subspecs), else the sole spec file — project-root paths, not the removed worktree copy.

**Rationale:** Archive resolution already returns a source dir; completion semantics are only unambiguous once the read path is pinned. Prevents implementer drift from run/triage resolution.

---

### 4. Pin `isSpecComplete` reuse contract (required)

**Outcome:** Decisions must require shared triage completion semantics (non-human-only linked-subspec rules) via a shared export, not a duplicated private copy in cleanup — rules out drift from triage/`--mark-ready`/`--merge`.

**Rationale:** Spec already pins triage semantics; without a reuse decision, two implementations can diverge silently.

---

### 5. Pin open-PR inspection failure semantics (required)

**Outcome:** When `findMatchingOpenPrs` throws (e.g. `gh` failure), archival must fail closed: skip with logged reason, continue other worktrees, exit `0` — same safety posture as abandon eligibility.

**Rationale:** Fail-open would allow premature archive under tooling failure; abandon already establishes the fail-closed pattern in the same command.

---

### 6. Pin multiple open PRs semantics (required)

**Outcome:** When more than one open PR matches the implementation branch, archival must skip with a logged reason (distinct from single open-PR skip or aligned with abandon's multi-PR pattern).

**Rationale:** Observable behavior differs from zero or one PR; abandon already refuses multi-PR — archive needs an explicit contract.

---

### 7. Address vacuous-complete bypass (required — pick one policy)

**Outcome:** Decisions must choose one policy when guard 1 would pass on specs with no non-human-only acceptance criteria (empty/malformed completion):
- require at least one non-human-only AC for archival eligibility, **or**
- treat vacuous-complete as incomplete when guards 2 or 3 would fire (in-flight worktree or open impl PR).

Include fixture-upgrade task coverage if existing happy-path archive tests rely on minimal `"# plan\n"` specs.

**Rationale:** Empty `.every()` completion lets guard 1 pass on malformed fixtures; with correct slug keying, premature archive becomes reachable on minimal specs while implementation is in flight.

---

### 8. Correct documentation task wording (required)

**Outcome:** Doc tasks must not promise removing a runbook "don't cleanup after plan merge" caveat — `operator-runbook.md` end-of-session cleanup has no such text. Refine to: document the archival guard and that routine cleanup is safe after a merged plan PR while implementation continues.

**Rationale:** Overclaimed doc edits create false acceptance work and misstate current operator docs.

---

### 9. Optional — dry-run scope pin (non-blocking)

**Outcome:** If retained out of scope, one Decision line: `--dry-run` unchanged; archive guards run only after confirmed removal (skips cannot appear in preview today).

**Rationale:** Prevents operator expectation mismatch; not blocking if left implicit.

---

### Upheld without required spec change

- Three-guard shape, exit-0 continue-on-skip, `--abandon` unchanged, `commit:false` parity, doc targets (`operator-runbook.md`, `v2/docs/v1-behaviors.md`), merged worktree removal before skip, excluding the just-removed worktree from the live-worktree check — sound; retain.
- `config.md` cross-link — optional, not required by documentation-standard placement policy.
- Concurrent multi-item archive ordering / destination-exists collisions — pre-existing; out of scope for this intent.
- Human-only AC remainder and index checklist ignored for completion — inherited triage semantics; no separate Decision unless documenting for clarity.
- Skip log tokenization beyond slug + guard label — existing deferral is sufficient once slug Decision is fixed.
