## Verdict: fixes required before merge

The write-loop advisory wiring matches subspec 01, but the reporter’s default production path is effectively broken. Two defects alone (#1–#2) cause empty reports in the common case (single-iteration complete with uncommitted changes). Additional gaps violate subspec 00, ready-gate prompt rules, and stated docs.

---

### Required outcomes

**1. Coverage data must survive until after lcov is parsed**

On the default path, `coverage/lcov.info` is deleted before it is read. A successful `bun test --coverage` must produce a report in production; tests that inject `readFile` must not mask this ordering bug.

**2. Diff scope must be the run-base working tree**

Subspec 00 requires `git diff <runBase>` plus untracked production files, not `<runBase>...HEAD`. At advisory time (before the completion commit), the completing iteration’s edits are typically uncommitted; a committed-only diff can be empty while substantial code changes exist. Docs already describe working-tree scope; implementation must match.

**3. Untracked production code files must yield reportable lines**

Untracked paths currently affect coverage scoping only. Lines from untracked production code files never enter the candidate set because they are absent from `git diff` output. The motivating “never-imported new module” case is often untracked-only. Untracked production code paths must contribute added-line candidates (all lines for new files, or equivalent). Tests must assert untracked file lines appear in the report, not only tracked diff lines.

**4. Coverage artifacts must live under gitignored `.scratch/` and be removed after parsing**

Subspec 00 pins `.scratch/` and delete-after-parse. Using `./coverage/` contradicts the spec; `coverage/` is not gitignored and failed cleanup risks absorption by the completion committer’s `git add -A`. Write lcov under `.scratch/`, read it, then clean up.

**5. Only production code lines may be reported**

Line reporting filters `isCodePath` and `type === "add"` but not `isProductionFile`. Changes to `*.test.ts` and similar can appear as “changed production lines,” contradicting subspec 00’s production scope and prompt copy. Apply the same production filter used for changed paths.

**6. `write.coverage-advisory` must have prompt render-coverage tests**

`prompts/write/coverage-advisory.md` is new and registered. `v2/docs/test-writing.md` requires a scoped test that renders it through `renderStepPrompt` and asserts rendered output. Without this, ready finalization can fail with `missing-render-coverage`. `write-loop.test.ts` checking `promptId` forwarding is insufficient.

**7. Coverage subprocess must fail soft on timeout**

Subspec 00 lists timed-out coverage runs alongside non-zero exit as fail-soft (no report, no throw). The default coverage invocation has no bounded timeout; a hung `bun test --coverage` can block the completing iteration until the outer write-loop timeout. Add a bounded timeout consistent with other harness subprocess calls.

**8. Fix documentation path reference**

`v2/docs/write-behavior.md` cites `v1/docs/ci-test-scope.ts`; the classifier is `scripts/ci-test-scope.ts`.

**9. Close subspec 01 test gaps called out in acceptance criteria**

- Add cases confirming `blocked` and `invocation_failure` outcomes do not invoke the reporter (only `progress` is covered today; implementation gates on `complete`, but AC requires tests).
- Guard-inversion ACs require tests that **fail when guards are inverted**, not positively named tests that only assert correct behavior. Current “fails soft when inverted…” cases would not catch a regression that re-inverts a guard.

---

### Accepted tradeoffs (no change required)

- **Fail-soft on red test suite:** Non-zero coverage exit returning no report is spec-intended; advisory must not block completion.
- **Advisory reuses completing `attemptId`:** Matches subspec 01 (sub-invocation, no iteration budget, no new attempt row).
- **Duplicate executed≠asserted disclaimer** in report text and prompt body: spec-driven redundancy.
- **Coverage scope simplification** (top-level dirs vs full `classifyChangedPaths` script mapping): advisory and fail-soft; false positives are acceptable. If kept, document the deliberate divergence from CI/integration scope in `write-behavior.md` so operators understand possible false “uncovered” signals.

---

### Rationale

Subspecs 00 and 01 exist to surface never-executed changed lines **before** the completion boundary, advisory only. Outcomes 1–5 are prerequisites for that signal to work at all in real git worktrees. Outcomes 6–9 are spec, ready-gate, and test-contract compliance. The write-loop integration is structurally sound; the reporter module and its test/doc obligations are where merge blockers remain.
