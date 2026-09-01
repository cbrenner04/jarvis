Verifying remaining documentation gaps and the landing-workflow commit behavior before issuing the verdict.
## Verdict

### 1. Finish durable documentation alignment (subspec 04)

**Required:** Operator-facing docs must describe the shipped behavior and must not reference removed mechanisms.

`v2/docs/write-behavior.md` still documents compare-and-swap terminal completion, `forceDistinctCommit`, and a guaranteed separate terminal completion SHA after per-iteration checkpoints. `v2/docs/operator-runbook.md` still names `forceDistinctCommit` as the terminal publication boundary. `Jarvis-Step: shrink` is documented in `v1-behaviors.md` but omitted from the standalone write `Jarvis-Step` list in `write-behavior.md`.

Subspec 04 acceptance criteria mark documentation complete; these passages contradict the implementation (`forceDistinctCommit` removed, terminal boundaries skip when `HEAD` already matches, per-turn SHAs preserved). Operators reading `write-behavior.md` for standalone writes or the runbook for completion hygiene will follow the superseded #3234 contract.

**Outcomes:**
- `write-behavior.md` commit-phase and per-iteration sections describe per-turn preservation, skip-when-clean terminal boundaries, and `shouldPublishSettledHead`-style publication when iteration SHAs already sit ahead of base — with no `forceDistinctCommit` or CAS-replace language.
- `Jarvis-Step` lists include `shrink` wherever step kinds are enumerated.
- `operator-runbook.md` terminal-completion boundary prose matches the new skip-when-clean model.
- Line 56 landing wording is unambiguous: promotion may occur at landing or workflow-completion tail only when the tree changes; it is not a guaranteed extra commit.

---

### 2. Resolve the reviewed plan/intent per-pass review commit contract

**Required:** Behavior, durable docs, and spec intent must agree on whether multi-pass review on staging-landing workflows (`plan-tree`, `intent-stage`) produces per-pass commits on the published branch.

Implementation disables per-pass review commits whenever `landing.kind !== "none"`. That is a deliberate staging-tree choice (per-pass commits would record transient `.jarvis-*-stage/` bytes that landing later deletes), but it conflicts with top-level `intent.md` (“every workflow… each review pass… its own commit”) and subspec 02’s ledger (no landing carve-out; tests only cover implement patch review with `landing: none`).

**Outcomes (pick one, then align docs and tests):**
- **Option A — Documented exemption:** Durable docs (`workflow-runner.md`, `write-behavior.md`, `v1-behaviors.md`) state explicitly that reviewed plan/intent workflows commit per write-loop turn on staging artifacts, but multi-pass review actuator edits on staging are not committed per pass; landing/promotion collapses those edits into the durable tree. Subspec 02 decision ledger and/or `intent.md` are narrowed to match. Add at least one regression locking the exemption (multi-pass reviewed intent or plan publication asserts expected commit count and agents).
- **Option B — Per-pass on landing workflows:** Multi-pass review on `plan-tree` / `intent-stage` yields one commit per mutating pass on the published branch, consistent with implement patch review and subspec 02 as written. Tests cover that path.

Leaving the gap undocumented is not acceptable: implement patch review is correct, but plan/intent reviewed workflows silently diverge from the stated contract.

---

### 3. Tighten duplicate-subject ordinal rule (subspec 01)

**Required:** Per-turn subject deduplication should follow subspec 01’s “repeat within the same phase on this branch” rule, not full `HEAD` ancestry or SQLite attempt count.

Current logic scans all subjects on `HEAD` and uses `attempts.length` for ordinals. Unrelated prior commits or skipped no-change iterations can produce misleading `plan: draft 3`-style subjects or miss true duplicates within the current run.

**Outcome:** Duplicate phase subjects within `baseRef..HEAD` (or an equivalent run-scoped subject set) get a write-loop iteration ordinal; unrelated ancestry does not force ordinals.

---

### 4. Fail visibly when a mutating review pass cannot be attributed (subspec 02)

**Required:** When `actuatorRan` is true but no actuator agent label resolves, the run must not silently omit the per-pass commit.

`commitMutatingReviewPass` returns early on empty agent with no `iteration_commit_failed` or operator signal. Write-loop iteration commits fail closed on missing attribution. Subspec 02 requires one commit per mutating pass; silent skip breaks that guarantee for misconfigured bindings.

**Outcome:** A mutating review or review-debate pass with no resolvable actuator agent fails the review step (or records `iteration_commit_failed`) rather than continuing with missing history.

---

### Not required for this actuator pass

- **`shouldPublishSettledHead` / `publicationSha` telemetry asymmetry** — publication succeeds when per-turn SHAs exist; behavior matches spec.
- **`discardEphemeralReviewVerdictDrift` ordering across review flavors** — no demonstrated landing or attribution regression.
- **Unrelated TUI failure-glyph styling** — scope noise; no publication contract impact.
- **`publishedCommitAgent` removal** — internal helper with no remaining callers.
- **`buildReviewPassCommitDeps` last-write-step assumption** — untested edge case outside current workflow shapes.
- **Synthetic attribution test seeds** — appropriate for footer contract tests; full reviewed-intent E2E is covered by outcome 2.
- **Unchecked `intent.md` acceptance block** — harness housekeeping, not an implementation defect.

---

### Rationale summary

Subspecs 00–03 land the implement patch-review path correctly: per-turn preservation, monotonic commit count, distinct subjects, per-pass light review and debate, multi-agent `## Commits` and footer. The patch is not fully closed because subspec 04 documentation is incomplete where operators actually read standalone-write semantics, and because reviewed plan/intent workflows have an undocumented behavioral exemption relative to the top-level intent and subspec 02. The ordinal and empty-agent items are smaller contract gaps that are cheap to close and prevent silent history loss or misleading commit subjects.