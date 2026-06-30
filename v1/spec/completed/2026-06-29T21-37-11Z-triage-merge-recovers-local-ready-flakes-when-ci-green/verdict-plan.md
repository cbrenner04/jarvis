**Verdict:** Approve direction; spec is not implementation-ready until the refinements below are incorporated. No intent drift; scope and atomicity are sound.

---

## Required refinements

### Testability (blocking)

- **Recovery probe injection:** Specify an injectable probe runner parallel to `runGate` / `getChecksForSha` so unit tests can cover all recovery paths without live `bun test`. `getChecksForSha` alone is insufficient for the six recovery scenarios in the task checklist.

### CI classification contract

- **Check-run → green/pending/red mapping:** Pin explicit adapter rules from GitHub commit check-runs (`status` + `conclusion`) into `CiCheckState[]` before calling existing `classifyCiChecks` — not raw API shapes inside `classifyCiChecks`. Cover: completed + success/skipped/neutral → green; completed + failure conclusions → red; queued/in_progress or completed with null conclusion → pending.
- **Repo identity for HEAD-sha fetch:** Pin owner/repo resolution via existing `normalizeRepoUrl` on worktree `origin`; fail-closed (no recovery) when parse fails, same as fetch failure.

### Probe and parser contracts

- **Probe invocation:** Probes mirror the gate’s serial test step: worktree `cwd`, `bun test` (not `bun run test`), same preload/setup; no ready-gate deadline on probes; signal/timeout exits are blocking, not recoverable flakes (consistent with `isGenuineTestFailure` / `v1-behaviors.md`).
- **Failing-file extraction:** Before implementation, anchor `(fail)` / `at <path>:<line>` patterns against a real failing gate stderr sample (or document a secondary pattern). Pin cap-8 order as first-seen in stderr traversal, deduped.
- **Deadline blocking:** Decision and ACs must use substring match `ready: deadline exceeded` (not exact full line).

### Blocking taxonomy and classification gates

- **Recovery eligibility is typed:** Only `ReadyCommandError` with harness test-step markers (`ready: parallel test failed` / `ready: serial test failed`) enters recovery. All other thrown errors — including generic `Error`, `FixCommandError`, push/commit dirty errors — refuse with no recovery attempt even if message text mimics test failures.
- **Additional blocking subclasses in ACs:** Refuse recovery when stderr contains deadline substring; when `ReadyCommandError` lacks test markers (e.g. lint/check); when probe 1 stays red and path extraction yields zero files (probe 2 skipped).
- **Custom `readyCommand`:** Decision + doc note that recovery applies only to built-in `scripts/ready.ts` marker stderr; custom ready commands produce `ReadyCommandError` without markers → no recovery.

### Acceptance criteria and task checklist

- **Recovery stdout:** ACs must assert the exact line from decisions: `triage --merge: local ready flake recovered (CI green at HEAD); proceeding`.
- **HEAD-sha fetch failure:** Task checklist must require a dedicated test where `getChecksForSha` throws or returns unusable data; AC 3’s bundle is sufficient for behavior but implementers need an explicit test obligation.
- **Preservation AC:** Strengthen or add AC so refusal-on-gate-failure is pinned to a typed non-recoverable error (e.g. `FixCommandError`), not only the existing generic-`Error` preservation test — recovery must not mis-classify by message substring alone.

### Documentation (`v2/docs/v1-behaviors.md`)

- Extend the `--merge` entry per existing Documentation updates section, plus:
  - Probe contract (serial `bun test`, no gate deadline, signal/timeout blocking).
  - Dual-CI edge case: recovery gates on HEAD-sha check-runs; post-recovery poll remains branch `gh pr checks` — recovery may proceed then abort if branch poll is red.
  - `readyCommand` override blocks recovery.
  - `--mark-ready` exclusion (already in doc updates; keep).

---

## Not required (defended; no spec change)

- Third full serial suite after gate parallel→serial retry (accepted cost for fail-closed merge safety).
- Per-file probe 2 passing while probe 1 red (intentional tradeoff; CI green + isolated file pass is sufficient rerun proof).
- Fast-tier recovery semantics, runbook cross-link, blanket “all `--merge` tests stay green” AC.
- Optional `getChecksForSha` shape on `TriageGhRunner` (matches existing optional `getChecks` pattern).

---

## Rationale

Refinements close gaps between intent (“rerun proof before bypass”) and an implementable, testable contract: without probe injection and pinned CI adapter rules, acceptance criteria cannot be verified in `triage-command.test.ts` as written. Blocking-subclass and typed-error ACs prevent silent broadening of recovery beyond parallel-load test flakes. Doc items satisfy `v2/docs/documentation-standard.md` durable-home requirement for operator-visible behavior without speculative runbook churn.
