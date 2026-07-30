Verifying the advocate's critical findings against the implementation before issuing the verdict.
# Verdict: required outcomes

The implementation matches the spec on validate-before-commit ordering, NUL-safe candidate enumeration, byte-ordered first-offender evidence, persistence shape, and separate review-mutation recovery routing. The following gaps block spec completion.

---

## 1. Ready-gate repair fence must run on production worktrees

**Outcome:** Derive, persist, and validate the frozen allowset on every ready-gate repair iteration in real Jarvis worktrees (`git worktree add`, where `.git` is a pointer file), not only repos where `.git` is a directory containing `HEAD`.

**Why:** The current `.git/HEAD` probe skips the entire repair fence on the normal production path. First-failure repair never persists a fence, so recovery cannot enforce what was never recorded. This defeats the spec’s core goal (PR #2228 / #2243 class of unfenced repair commits).

**Evidence required:** At least one regression using `git worktree add` that proves out-of-scope repair edits are rejected before commit/republish.

---

## 2. Spec scope must match the written contract

**Outcome:** Descendant allowlist membership applies only to (a) a directory spec scope and (b) the parent directory of an `index.md`. A standalone spec file — including root-level `spec.md` and non-`index.md` subspec files — allows **only that file**, not its parent directory or the whole repo.

**Why:** Subspec 00, `write-behavior.md`, and the intent all state this rule. Treating any `.md` like `index.md` makes `spec.md` allow every path when the parent is `.`, which is the opposite of the intended fence.

**Evidence required:** A positive case where repair inside a standalone `spec.md` succeeds, and rejection when repair touches a sibling file outside that file.

---

## 3. Corrupt persisted fence must fail closed on recovery

**Outcome:** When the durable row holds fence JSON that cannot be parsed or validated, completed-run retry, `jarvis run resume`, and review-mutation recovery must return `completion_commit_failed` — not treat the fence as absent and skip enforcement.

**Why:** Subspec 01 and `write-behavior.md` require fail-closed reconstruction. Collapsing bad JSON to `null` at load time bypasses the only recovery guard for tampered or corrupted state.

**Evidence required:** Recovery regression with intentionally invalid fence column content that fails closed; invert/bypass guard makes it pass.

---

## 4. Fence must not apply to mutation repair or other excluded routes

**Outcome:** The ready-gate repair fence applies only to ready-gate repair re-commits and to recovery paths that must prevent sweeping a **rejected** dirty path. It must **not** block mutation-repair commits or primary completion when repair succeeded without rejection.

**Why:** Subspec 00 explicitly excludes mutation repair from the fence. Unconditional enforcement in `runMutationRepairAttempt` (and similar paths) can reject legitimate mutation fixes to files outside the pre-repair frozen diff. Review-mutation recovery (subspec 02) requires blocking rejected paths, not blanket-blocking every persisted fence including successful repairs.

**Evidence required:** Regression showing mutation repair can commit paths outside the frozen pre-repair allowset after a **successful** ready-gate repair; review-mutation recovery still blocks when `rejectedPath` / `completion_commit_failed` provenance is set.

---

## 5. Stale fence must not block legitimate post-repair completion

**Outcome:** After ready-gate repair completes successfully (no rejection provenance), a subsequent completed-run retry or resume must not be rejected solely because repair commits introduced paths not in the originally frozen `exactPaths`.

**Why:** The allowset is frozen from pre-repair `<baseRef>...HEAD` and does not grow with successful repair commits. Leaving it enforced on later generic completion is a footgun inconsistent with unchanged in-scope repair behavior.

**Evidence required:** Successful repair followed by completion retry that stages only post-repair legitimate work completes without `completion_commit_failed`.

---

## 6. Candidate-path acceptance coverage must include type changes and submodules

**Outcome:** Representative regressions prove the candidate set includes type changes and submodules, as required by subspec 00 acceptance criteria and documented in `write-behavior.md`.

**Why:** Current contract test covers additions, deletions, rename destination, tracked-ignored, and unusual filenames but not the two explicitly listed kinds.

**Secondary:** Assert rename **source** side in candidate enumeration when applicable.

---

## 7. Documentation must match enforced semantics

**Outcome:** Update `v2/docs/write-behavior.md` so fence recovery language distinguishes:
- never established (no repair fence expected → no enforcement),
- present but invalid (fail closed),
- present with rejection provenance (enforce on recovery routes per subspec 01/02),

and reflects the corrected spec-scope and mutation-repair exclusions above.

**Why:** Docs currently describe behavior the code does not provide (#1–#5) and overstate unconditional fail-closed on “missing” fence.

---

## Not required for actuator

- Checking boxes in `intent.md` (routing artifact; subspecs carry acceptance).
- Test seam flags on production types (established pattern; invert regressions are load-bearing).
- `repairCommits === 2` assertion clarity (test hygiene only).
- Invalid-path ordering among multiple non-normalizable candidates (edge case below spec’s ordering guarantee).