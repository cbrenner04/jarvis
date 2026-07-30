Reviewing the implementation and docs against the spec before issuing the verdict.
## Verdict: required outcomes

### 1. Production candidate enumeration must match completion staging exactly

`enumerateRepairCompletionCandidates` must not filter paths that `createCompletionCommitter` would stage. The `.reused` harness marker belongs in test seams only.

**Why:** Subspec `00` requires the candidate set to exactly match repair-completion staging. Production filtering of `.reused` breaks that contract and can let a staged path bypass the fence in environments where that marker exists.

---

### 2. Candidate-contract regressions must cover the change kinds the spec claims

Tests must demonstrate real submodule entries and file↔symlink (or equivalent) type changes in the candidate set, not only `gitdir:` stubs and renames/deletes.

**Why:** Subspec `00` acceptance criteria are ticked on representative coverage for additions, deletions, type changes, tracked ignored changes, submodules, and both rename sides. Current coverage overstates what is proven.

---

### 3. “Missing persisted fence fails closed” must be true in docs and behavior, with an explicit boundary

Docs (`write-behavior.md`, subspec `01`) and recovery enforcement must agree on when a null/missing fence row is an error versus when it means ready-gate repair never ran and recovery should proceed unfenced.

**Why:** Subspec `01` and the operator doc both state that a missing or invalid persisted fence fails closed as `completion_commit_failed`. Implementation treats absent provenance as pass-through. That mismatch is either a doc error or an enforcement gap for runs that entered repair but lack a persisted row (migration, partial write, etc.). The primary rejected-repair path is covered; the stated contract is not.

**Required end state:** One coherent rule, documented and enforced, that preserves unfenced recovery for runs that never entered repair while still preventing a rejected repair from being swept in when provenance should exist.

---

### 4. Persisted fence provenance must not mislabel successful repair as `completion_commit_failed`

The durable row written at first-repair freeze must distinguish “active frozen allowset” from “rejected with offending path.” A successful bounded repair must not leave provenance that reads as a `completion_commit_failed` settlement.

**Why:** Subspec `01` requires persisting rejection provenance together with the allowset. Writing `outcomeKind: "completion_commit_failed"` on every freeze—including before any violation and after successful repair—misstates run health and confuses operator/DB inspection. Enforcement behavior is correct; provenance semantics are not.

---

### Not required in this pass

- **Committed-only allowset vs classifier untracked inventory:** Intentional per subspec `00`; document as a known seam only if operator-facing clarity is needed, not as a fence bug.
- **Recovery commit-vs-publish asymmetry, no-HEAD skip, weak JSON validation, markdown-only spec-tree enumeration, test bypass hooks, seeded review-mutation fixtures:** Acceptable or pre-existing; no actuator change required for spec completion.
- **`intent.md` unchecked boxes:** Superseded by subspecs `00`–`02`; hygiene only.