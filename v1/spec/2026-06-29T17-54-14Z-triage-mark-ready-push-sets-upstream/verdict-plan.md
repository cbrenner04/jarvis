## Verdict — required refinements

### 1. Resolve AC #2 vs scoped fix (blocking)

Acceptance criterion #2 (clean worktree, unpushed commits, no upstream → push with `-u` and continue) contradicts the subspec’s scoped fix and its explicit deferral of `computeUnpushed` changes. With current code, `computeUnpushed` returns `0` when no upstream exists, so that path never reaches `pushWorktreeOrFail`; the planned `firstPush: !hasUpstream(...)` change cannot satisfy AC #2.

**Required outcome:** Drop AC #2, or move equivalent behavior to an explicit deferred/out-of-scope note consistent with the decision ledger — not both an AC and a deferral. Do not ship a criterion the scoped implementation cannot meet.

### 2. Align intent with subspec push-path scope

Intent describes any complete worktree with no upstream; the subspec correctly centers the dirty-finalize path (and clean paths only when `computeUnpushed > 0`). The clean + no-upstream + unpushed gap is deferred in the subspec but not in intent.

**Required outcome:** Narrow intent to paths that reach `pushWorktreeOrFail`, or add matching intent-level deferral for clean-unpushed-without-upstream. Intent, decisions, and acceptance criteria must agree on what is in vs out of scope.

### 3. Make `-u` usage mechanically verifiable

AC #1 requires `git push -u origin <branch>`, but tasks/tests as written do not pin that observable. `setupMarkReadyWorktree` always sets upstream; a green end-to-end test would not prove `firstPush: true`.

**Required outcome:** Add a task and acceptance criterion (or tighten AC #1) so verification observably confirms upstream setup — e.g. injectable push seam, post-success upstream ref assertion, or git argv capture. Without this, AC #1 is not enforceable.

### 4. No-upstream test fixture

Happy-path coverage needs a worktree with `origin` present and upstream unset; the existing helper always runs `git push -u`.

**Required outcome:** Task checklist must call for a dedicated no-upstream fixture (or equivalent setup steps) so the new behavior is actually exercised.

### 5. Push-failure test must exercise real finalize + push

The existing push-failure test stubs `commitAndPushDirty` entirely, bypassing `pushWorktreeOrFail` and leaving “commit intact” unverified. The checklist duplicates that test name without clarifying extend vs replace.

**Required outcome:** Specify that push-failure coverage runs a real finalize commit then a failing push on the changed path; assert non-zero exit with `failed to push finalize commit`, no PR open, no gate, and HEAD unchanged. Clarify whether this extends the existing test or adds a sibling — avoid duplicate ambiguous tasks.

### 6. Remove orphan verification if AC #2 is dropped

If AC #2 is deferred/dropped, ensure no task or test remains that only served it.

**Required outcome:** Task checklist and acceptance criteria stay paired; no criteria without tasks/tests, no tasks without criteria.

---

### Not required (acceptable as-is)

- Preservation ACs citing behind-base and lock tests — sufficient for this one-line push-flag change; upstream guards (incomplete spec, non-DRAFT PR) sit before finalize and need not be re-pinned.
- Doc targets (`v2/docs/v1-behaviors.md`, `v1/docs/operator-runbook.md`) — aligned with documentation standard and intent; run-loop cross-link optional.
- Missing-`origin` behavior — unchanged by this fix; no load-bearing decision needed.
