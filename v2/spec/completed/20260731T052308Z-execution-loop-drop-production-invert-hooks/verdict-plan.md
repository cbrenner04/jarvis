Verifying key codebase points cited in the advocate review before issuing the verdict.
## Verdict: required refinements

### 1. Cover `resolveIterationSettlementKind` — blocks first AC and downstream static guard

The first acceptance criterion forbids all four hook shapes, including `invert*` function parameters. Production still exports `resolveIterationSettlementKind(role, invert: boolean)` and threads `invertAbortWatchdogPrecedenceForTest` into it. Tasks address `WriteLoopInput` fields and fence-helper parameters but omit this export.

**Required outcomes:**
- Tasks and decisions must include removing the `invert` parameter and fixing the real abort/watchdog mapping with no invert plumbing.
- Tasks must address `abort-vs-watchdog precedence predicate: both truth directions, no real-timer wait` (currently exercises `invert: true`) and the dedicated inversion block slated for deletion.
- A decision on whether the helper stays exported, becomes private, or is inlined once invert plumbing is gone.
- When the inversion block is removed, preserve its race-ordering scope boundary (what comment-checkpoint inversion does *not* cover) on the positive `watchdog-first` pinning test or equivalent.
- At least one `(Manual)` mutation AC for the documented `resolveIterationSettlementKind` precedence mutation, or an explicit decision narrowing manual pins that still satisfies intent-level guard-inversion evidence.

**Rationale:** Leaving this parameter violates the structural first AC and would fail `guard-production-test-flags` after this spec lands. The cited daemon exemplar pairs checkpoint tasks with manual mutation ACs; a checkpoint task without a matching manual AC is unenforced at completion.

---

### 2. Align guard-inversion AC coverage with checkpoint tasks and intent

Tasks name comment checkpoints on roughly a dozen guards across write-loop, terminal-publication, project-pipeline-resolution, and TUI tests. The subspec carries one `(Manual)` mutation AC (sidecar fence). The intent AC requires guard-inversion tests to go RED on source mutation — broader than what the subspec enforces.

**Required outcomes (choose one and state it in Decisions):**
- **Daemon-pattern:** `(Manual)` mutation ACs for each named checkpoint (or each module cluster), plus matching stays-green ACs citing the pinning test — mirroring `daemon-drop-production-invert-hooks`.
- **Narrowed scope:** A decision explicitly limiting manual mutation verification (e.g., one representative pin per module cluster, with sidecar fence as the write-loop pin) and narrowing the intent AC to match.

**Rationale:** Spec guidance requires guard-inversion evidence for executable changes; tasks alone do not block completion. Citing the daemon exemplar without its AC pairing creates a false sense of coverage.

---

### 3. Split the oversized subspec by module boundary

Six independently implementable surfaces are bundled in one subspec: write-loop, workflow-runner, terminal-publication, project-pipeline-resolution, external-worktree, tui-monitor-terminal-window. Spec guidance requires one module boundary per subspec.

**Required outcomes:**
- Split into independently testable numbered subspecs (e.g., per surface or per logical cluster), each with scoped tasks, acceptance criteria, and documentation section.
- `index.md` must link every replacement subspec.
- Every task and acceptance outcome from the current draft must appear exactly once across replacements — no compression or omission.
- Shared prerequisites (write-step rules, daemon, CLI cleanup) and the `guard-production-test-flags` ordering note can live in the index or first subspec.

**Rationale:** Independence and reviewability; a missed hook in one surface should not block verification of another.

---

### 4. Fix checkpoint and preservation AC precision

Several task/AC pairings are misaligned or incomplete:

| Gap | Required outcome |
|-----|------------------|
| Held-repair checkpoint targets "killed terminal" but the positive pin is `joins a held ready repair before $terminal becomes durable` (`test.each` over completed/failed/killed) | Checkpoint task and any manual AC must cover the `test.each` block and all three terminal rows, naming all three guard mutations |
| `workflow-runner.ts` edit surface is `ReviewMutationResumeDeps`, not `IntentFinalizationResumeDeps` | Tasks must name `ReviewMutationResumeDeps` |
| `workflow-runner.test.ts` task references `invertReadyGateRepairFenceForTest` threading that does not exist today | Drop the task or reword as post-cleanup confirmation on production `workflow-runner.ts` |
| AC #2 uses migration wording ("fails against pre-change tests that rely on the invert input field") | Steady-state wording: documented mutation turns named pinning test RED `(Manual)` |
| Missing stays-green ACs for checkpointed tests: leave-draft path, failure-preservation, `retains non-terminal rows…`, `watchdog-first` abort-vs-watchdog, held-repair `joins a held ready repair…` | Add stays-green ACs citing each named pinning test, or document in Decisions that preservation ACs are limited to one representative per cluster |
| TUI row-cap guards exercised on unit and integration paths; only unit test has stays-green AC | Stays-green AC for `retains non-terminal rows and caps terminal rows by finish time`, or explicit note that integration coverage is out of scope |

**Rationale:** Spec guidance: refactor preservation ACs cite the test, don't paraphrase. Misnamed types and stale tasks invite wrong edits. Checkpoint scope must match the tests that actually pin the guards.

---

### 5. Align `intent.md` with repo state and subspec

`intent-output.ts` has `Mutation checkpoint:` comments only — no invert hooks, setters, or parameters. The intent Problem/Decisions still claim optional invert parameters must be deleted and list `intent-output.ts` among hook carriers.

**Required outcomes:**
- Update intent Problem/Decisions to match subspec: verify-only for `intent-output.ts`; no production hooks to remove.
- Align intent acceptance criteria with the subspec's guard-inversion AC strategy (full daemon pairing vs narrowed manual pins).
- Optionally add a verify AC or task confirming `intent-output.ts` is clean under the first AC glob (redundant with sweep but closes intent drift).

**Rationale:** Intent is the seed contract; stale vocabulary misroutes implementers and plan reviewers.

---

### 6. Document `guard-production-test-flags` ordering dependency

`ready-intents/guard-production-test-flags.md` lists execution-loop/TUI hook removal as a prerequisite. Neither prerequisites nor decisions state that this spec must land before the static guard.

**Required outcomes:**
- One line in Prerequisites or Decisions: this spec lands before `guard-production-test-flags`; residual `invert*` shapes here would fail that guard.

**Rationale:** Prevents parallel implementation that strands the mutant-fix chain documented in `implement-queue.md`.

---

### 7. Minor consistency (non-blocking but should fix in same refinement pass)

- Standardize checkpoint comment prefix on `Mutation checkpoint:` to match the cited daemon exemplar and `v2/docs/test-writing.md` primary convention (CLI uses `Inversion target:` for cross-boundary guards — acceptable where CLI owns the pin).
- `external-worktree` lock-release evidence via CLI `workflow.test.ts` prerequisite is defensible; no execution-owned AC required if prerequisite text remains explicit.

---

### Summary

The spec correctly inventories most hooks, picks the right highest-risk pin (sidecar fence), and follows the strip-hooks → comment-checkpoint pattern. It is **not safe to implement as written** until:

1. `resolveIterationSettlementKind` and its test surface are fully scoped (tasks, decisions, manual AC).
2. Guard-inversion AC coverage matches checkpoint breadth or an explicit narrowed decision replaces the intent AC.
3. The subspec is split by module boundary with complete task/AC redistribution.

Secondary refinements (intent drift, naming, preservation AC gaps, prerequisite ordering, caveat preservation) should land in the same refinement pass to avoid another review cycle.