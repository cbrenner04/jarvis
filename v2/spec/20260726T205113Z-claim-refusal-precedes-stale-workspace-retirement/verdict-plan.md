Checking a few codebase facts so the verdict matches implementation reality.
## Verdict: required refinements

### 1. Pin claim-probe parity with daemon `start` (blocker)

The subspec still defers how the client learns “`start` would refuse with `worktree_claimed`.” That must be **decided and written into Decisions before merge**, not left to implementation. Today workflow re-runs pass a no-op daemon client into `resetStaleWorkspace`, so live-held never consults the daemon; a `list` mapper that only exposes `isLive` still **misses** queued (`isLive: false`) and registry-only claims that `handleWorkflowStart` already rejects in tests.

**Outcome:** The spec must state that the pre-mutation claim gate uses the **same refusal predicate** as daemon workflow admission (whatever mechanism: dedicated RPC, dry-run admission, or an explicitly documented composite), and that ad-hoc `list`+`isLive` alone is insufficient unless the spec proves equivalence.

**Rationale:** Without this, the intent (“consult claim before mutation”) can be “implemented” while production still retires then fails at `start`.

---

### 2. Define the seam between `resetStaleWorkspace` and workflow stderr

Tasks split daemon wiring from `worktree_claimed:` stderr, but the refuse **result contract** is unspecified. Dirty and other stale-reset refusals use the generic `Cannot re-run incomplete spec:` wrapper; claim is intentionally `worktree_claimed:` via `formatRpcError`.

**Outcome:** Decisions (or ACs) must require a **typed, non–stderr-scraped** signal (e.g. distinct reason/code on the reset result) so the workflow layer branches once for claim vs generic refusal.

**Rationale:** Prevents fragile string matching and documents the dual stderr contract as intentional.

---

### 3. Add a failing-test AC for the `resetStaleWorkspace` seam

Tasks require `cleanup.test.ts` coverage; acceptance criteria only gate workflow tests. Spec guidance requires a named test that **fails pre-fix** for each runtime behavior change on the seam.

**Outcome:** Add an acceptance criterion for `cleanup.test.ts` (claimed `(project, branch)`): refused before abandonment, artifacts intact, no retirement subprocess side effects, fails against pre-fix ordering.

---

### 4. Tighten workflow ACs: fixtures, artifacts, and duplication

- **Intent** requires local branch, **remote branch**, worktree, and open PR intact; workflow ACs should explicitly require a **pushed remote** that survives refusal.
- **`worktree_claimed` scenarios** must be specified so fixtures represent **claim without live-held firing** (`isLive` false or equivalent) while admission would still refuse—so implementers do not satisfy ACs with only `isLive: true` mocks that would hit live-held first once the real client is wired.
- **Three AC rows** reuse the same test title for overlapping assertions (stderr, no retirement block, artifacts). **Outcome:** One coherent AC per test (or clearly differentiated titles) so harness checkboxes map 1:1 to verifiable outcomes.

---

### 5. Refactor/preservation and guard-inversion wording

- Preservation should **cite a specific pinning test** in `cleanup.test.ts` (happy-path stale reset), not “the whole `describe` stays green,” per refactor-AC guidance.
- Guard-inversion AC should state that “gate forced off” means a **test-local `DaemonClient` double** (or equivalent), not a production feature flag.

---

### 6. Decide daemon-unreachable behavior on claim probe

Live-held today tolerates RPC errors in `isWorktreeLiveHeld`. The new claim probe has no specified policy.

**Outcome:** Decisions must pick **fail-open vs fail-closed** when the claim probe cannot reach the daemon. Default alignment with intent (“guard protects artifacts”) favors **fail-closed** (no retirement without a successful claim check), unless the spec explicitly chooses parity with live-held.

---

### 7. Documentation outcomes (operator-runbook + v1-behaviors)

Doc tasks are directionally right but incomplete for operator safety:

- **Pre-mutation refusals** must list **both** live-held (existing wrapper message) and `(project, branch)` claim (`worktree_claimed`), once the connected client is wired—not only claim.
- Revise “Workflow reports a stale worktree claim” to separate: (a) pre-mutation claim refusal (artifacts intact), (b) post-retirement `start` failure (the bug class), (c) claim acquired **after** retirement but before `start`, and (d) guidance when **partial teardown already happened** (not “re-invoke is always safe”).
- If the client probe can be **stricter** than post-retirement `start` (e.g. reclaim paths only at admission), document that pre-mutation refusal may refuse when a bare `start` after retirement might succeed—acceptable when it prevents destruction.

---

### 8. Optional but low-cost

- If daemon tests already pin message text, consider AC strength beyond `stderr contains worktree_claimed:` (full parity with shared message helper)—only if operator/TUI docs depend on exact text.
- Copying **Prerequisites** from intent into the subspec is conventional, not blocking.

---

**Overall:** The spec correctly targets the seam (client-side retirement before `start`, noop daemon client today) and the right operator outcomes (no `Retirement destroyed artifacts:` on pre-mutation claim). **Merge-ready** after closing probe parity, seam contract, daemon-error policy, AC/doc tightening above—not a subspec split.