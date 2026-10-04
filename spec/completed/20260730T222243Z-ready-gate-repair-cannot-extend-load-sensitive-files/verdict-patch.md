Reviewing the implementation and spec to validate the advocate's findings before issuing the verdict.
## Verdict: required outcomes

### 1. Fix membership baseline so implement-time growth does not false-reject repair (blocking)

**What must be true:** The load-sensitive membership guard rejects only entries introduced by the repair staging, not entries already committed on the run’s primary path before repair runs.

**Why:** The guard compares staged `scripts/test-slice.ts` against `git show <baseRef>:…`. `baseRef` is the run’s frozen merge base and predates implement commits. If implement legitimately added `LOAD_SENSITIVE_FILES` entries (operator policy during the write loop, not repair), any repair that stages that file — even comment-only or reorder churn — sees those entries as “new” vs `baseRef` and returns `completion_commit_failed`. That contradicts subspec intent (“non-growing edits remain subject only to the ordinary path fence”), AC3’s positive allowance, and the incident scope (block repair-time policy relaxation, not punish prior committed growth).

**Required:**
- Baseline membership must reflect committed state at repair validation time (membership already on `HEAD` before repair edits), not merge-base membership.
- A regression test must cover: run diff grows `LOAD_SENSITIVE_FILES` (or otherwise leaves `HEAD` membership strictly larger than `baseRef`), repair stages a non-growing edit to `scripts/test-slice.ts`, repair completes without `completion_commit_failed`.
- Durable docs (`v2/docs/write-behavior.md`, and `v2/docs/v1-behaviors.md` if its fencing bullet still says `<baseRef>`) must describe the actual baseline.

---

### 2. Close AC2 decoupling gap (blocking)

**What must be true:** Automated proof that the membership guard and path-fence guard are independent — disabling or bypassing path-fence rejection does not disable load-sensitive extension rejection.

**Why:** AC2 is ticked but references `invertReadyGateRepairLoadSensitiveGuardForTest` / `invertReadyGateRepairFenceForTest`, which no longer exist after `execution-loop-drop-production-invert-hooks`. The rejection test’s mutation checkpoint documents membership-guard existence but does not prove decoupling. AC2’s second clause (“with only path-fence invert enabled, membership guard still rejects”) has no automated coverage; ticking it overstates what the branch proves.

**Required:**
- Coverage (repo mutation-checkpoint convention is fine) that a repair extending `LOAD_SENSITIVE_FILES` still yields `completion_commit_failed` when path-fence logic alone would not block it — e.g. extension on an in-allowset path, with explicit checkpoint that mutating/disabling `findFirstRepairFenceViolation` does not disable the membership check.

---

### 3. Strengthen positive allowance test fixture (blocking, tied to #1)

**What must be true:** The `allows ready-gate repairs that edit test-slice without growing LOAD_SENSITIVE_FILES` test exercises a scenario where `HEAD` membership already exceeds `baseRef` membership before repair runs.

**Why:** Current fixture captures `baseRef` before the run-diff commit and only adds a comment in the run diff, so membership at `baseRef` and `HEAD` are identical. That cannot catch the false-positive in #1. AC3 requires the positive path to work when the file is in the frozen allowset and repair does not grow membership — including after legitimate implement growth.

**Required:**
- Extend the positive test setup so implement commits add at least one list entry (or otherwise establish `HEAD` ⊃ `baseRef` membership), then repair applies comment-only or literal-reorder churn and completes successfully.

---

### Not required for this pass

Fail-open when baseline is unreadable, comment-embedded phantom literals, single-quoted literals, untested removals/reorder-only cases, recovery-path integration, `offendingPath` shape, unnormalized `candidates.includes`, missing positive mutation checkpoint, and open `intent.md` checkboxes are acknowledged gaps but outside blocking scope for this incident-scoped spec. Optional hardening may follow separately.