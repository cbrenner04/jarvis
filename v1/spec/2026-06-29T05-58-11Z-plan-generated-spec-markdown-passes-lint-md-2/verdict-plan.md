## Verdict: required refinements

### 1. Reframe problem scope and primary fix

The observed `repo: https://…` MD034 failure comes from `commit: false` inject (`injectRepoLineIntoIndex` runs only when `commit === false`; `commit: true` strips non-contract index lines including `repo:` at draft). The north-star failure mode for default in-repo plan is model-emitted violations in numbered subspecs.

**Required:** Problem and decisions must state pre-ready markdownlint autofix on `index.md` + numbered subspecs as the primary `commit: true` fix; `injectRepoLineIntoIndex` shaping is secondary — `commit: false` inject + resolver compatibility for bracket/slug forms.

### 2. Decide `intent.md` vs `lint:md` globs

Harness `lint:md` scans `v1/spec/**/*.md` (includes `intent.md`). Repair scope excludes `intent.md`. Plan copies ready-intent bytes verbatim.

**Required:** Pick and record one outcome: include `intent.md` in repair, exclude it from lint globs, or add an explicit prerequisite that consumed ready-intents are lint-clean before plan. Leaving the hole unaddressed allows ready-gate failure after autofix on everything else.

### 3. Wire or narrow resume ready/repair behavior

`plan-mode.md` documents that a successful `jarvis1 plan --resume …` retries the readiness transition when an earlier gate failed. Code today calls `safeMarkPlanPrReady` only on fresh-run success; successful resume exits without repair or ready.

**Required:** Either extend this subspec so successful `commit: true` resume runs the same repair-then-ready path, or explicitly defer resume wiring to a separate subspec and narrow doc claims so they match code. Doc/code drift on resume is pre-existing but this spec anchors repair “before `runReadyAndCommit`” — that path resume never reaches.

### 4. Pin repair callsite and commit ordering

Task checklist names both `maybeMarkPlanPrReady` and `runReadyAndCommit` without choosing. Autofix edits must land in worktree porcelain before `runReadyAndCommit`’s pre-ready fix commit.

**Required:** Decision + AC that repair runs in the plan worktree immediately before the readiness transition entry point (`safeMarkPlanPrReady` → `maybeMarkPlanPrReady` → `runReadyAndCommit`), not inside `runReadyAndCommit` after porcelain is classified. Name the hook (e.g. `repairPlanSpecMarkdown`) in decisions, tasks, and test ACs.

### 5. Name shared helper extraction target

“Extract from `v1/src/commands/intent.ts`” leaves implementers choosing back-import vs duplication.

**Required:** Decision naming a neutral shared module under `v1/src/` (not `commands/intent.ts` ← `modes/plan/`).

### 6. Port MD018 off-line-start guard before autofix

Intent emit established that markdownlint `--fix` *causes* MD018 corruption on line-leading `#NNN` (promotes issue refs to headings). Plan copies the subprocess contract but not the guard.

**Required:** Decision + AC that plan repair applies the same off-line-start protection before autofix, or explicitly records acceptance of reference→heading corruption. Silent omission is a regression risk for draft/review subspec content.

### 7. Reconcile autofix with index contract cleanup

`stripNonContractIndexLines` runs once after draft, not after review. Review can re-add `repo:` or other non-contract lines; autofix may MD034-sanitize them but leave contract-violating content in `index.md`.

**Required:** Decision for post-repair index contract enforcement — re-run `stripNonContractIndexLines` (or equivalent) after repair when review may have reintroduced non-contract lines.

### 8. Extend inject normalization to SSH origins

Decisions cover HTTPS slug/bracket only. `detectGitOrigin` commonly returns `git@github.com:owner/repo`, which inject emits raw and can still trip MD034.

**Required:** Decision + AC that slugifiable SSH/scp-style GitHub origins emit `repo: owner/repo`, or bracket-wrap when not slugifiable — same rules as HTTPS.

### 9. Tighten acceptance criteria and documentation

**Required outcomes:**

- Manual AC must pin `commit: true`, successful auto-ready transition, and spec path under `lint:md` globs — not a vague “after plan” check.
- Add `v1/docs/spec-guidance.md` to documentation updates: index example and accepted `repo:` shapes must match slug/bracket canonical forms (example still shows bare `https://`).
- `plan-mode.md` update must state repair file scope (`index.md` + numbered subspecs; `intent.md`/`verdict-*.md` per decision #2), and resume repair/ready behavior per decision #3.
- Optional but low-cost: regression AC that slug-form `repo: owner/repo` resolves via existing `readRepoPath`/`normalizeRepoUrl` (no bracket strip needed).

### 10. Uphold without refinement

- Keep `lint:md` authoritative in ready tier — no relaxation or reorder.
- Warn-and-continue on missing markdownlint binary — intentional degraded path.
- Defer full `commit: false` external-tree repair — consistent with intent out-of-scope.
- Directory-scoped repair (active spec dir only) — sufficient for north star; no full `v1/spec` corpus repair.
- Preservation AC citing `intent-command.sandbox-unrunnable.test.ts` after helper extraction — correct refactor pattern per spec guidance.

---

**Rationale summary:** Refinements close gaps between spec claims and code facts (`commit: true` vs inject, resume vs fresh), prevent silent ready-gate failures (`intent.md` hole), and avoid known regressions (MD018 corruption, index contract drift) already documented in completed intent-emit work. Without them the spec can pass ACs while the operator north star — auto-ready without hand-fixing markdown — still fails on common paths.
