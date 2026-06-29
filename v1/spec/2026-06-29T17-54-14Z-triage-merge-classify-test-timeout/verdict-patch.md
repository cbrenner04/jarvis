## Verdict — required outcomes

### 1. Close the audit trail in the subspec

The subspec requires repro under `bun run test`, recording failure signature and standalone vs loaded timing, then choosing a fix fork from that evidence. Acceptance criteria are checked but the Problem still hedges (“repro must confirm…”), the task checklist is not reflected in durable text, and nothing records which fork was taken.

**Required:** Add a terse **Outcome** (or equivalent closing section) in `00-merge-classify-test-timeout.md` that states:

- Repro result on current `main` under the full-suite parallel gate (`bun run test`): pass or fail, and failure signature (Bun timeout vs assertion) if it failed.
- Approximate standalone and loaded runtime for `--merge classifies all spec check statuses correctly`.
- Selected fork: **30s preload default already suffices — verify and close; no per-test override** (or another fork only if repro proves otherwise).
- Why no harness edit: measured runtime vs effective 30s bound from `setDefaultTimeout` in preloaded `test/setup-fake-agents.ts`.
- Closure of the operator-report hedge: flakes at ~5s / without preload are consistent with pre-preload or non-gate runs; gate path is green at 30s.
- Explicit supersession of `intent.md`’s obsolete `{ timeout: 15000 }` remedy.

**Rationale:** Decisions and tasks bind cause to fix; closing without this record is indistinguishable from accidental checkbox ticks and weakens downstream specs that treat this work as a verified prerequisite.

### 2. Reconcile the sibling-audit prerequisite claim

`v1/spec/ready-intents/triage-command-sibling-timeout-audit.md` lists as a prerequisite that this test **“passes reliably under full-suite parallel load.”** The refined subspec AC only requires a single green `bun run test` — harness-norm verification, not demonstrated flake resistance.

**Required:** Align prerequisite strength with what this spec actually establishes — either:

- Soften the sibling prerequisite to **“passes under full-suite parallel gate”** (matching subspec AC #1), **or**
- Add explicit repeat/stress verification to this spec’s tasks/Outcome and record those results before merge.

Do not leave “reliably” in a downstream prerequisite unless this spec’s verification depth supports it.

**Rationale:** The sibling audit depends on this closure; overstating reliability propagates a false prerequisite into marginal-case timeout work.

### 3. Zero test diff is acceptable only with documented fork-1 verification

No change to `v1/test/triage-command.test.ts` is correct **if and only if** Outcome #1 documents that repro at the 30s effective bound showed sufficient headroom and fork 1 was selected. No per-test `{ timeout: N }` unless repro proves need **relative to 30s**.

**Rationale:** Fork 1 is spec-authorized; the gap is missing proof and fork pin, not missing code by default.

---

### Not required

- Re-demonstrating failure at Bun’s nominal ~5s bound without preload (out of gate scope).
- Per-test timeout override for ~5.25s runtime against a 30s default.
- Durable docs beyond the subspec Outcome (subspec explicitly excludes test-only doc churn).
- Strengthening pending-case assertions or changing `triage --merge` behavior.
- Full rewrite of `intent.md` (subspec supersession line suffices).
