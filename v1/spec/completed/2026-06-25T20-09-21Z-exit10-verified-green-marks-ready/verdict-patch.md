## Verdict

### Required outcomes (blocking)

**1. The promotion must run through the named completion-ready seam, not a hand-rolled inline copy.**
The spec decision is explicit: re-run the gate via the same completion ready path used at run completion (`runReadyGateWithTier`/`maybeMarkReady`). The current implementation reimplements that body inline with raw `execFileSync`, and the copy has already drifted from the original in two ways that matter:
- The fix-up commit drops the `Jarvis-Agent:` trailer that the seam appends. This violates the repo's PR-attribution convention (every commit must carry the trailer). The recovery commit must carry it.
- The final `gh pr ready` call is no longer wrapped in the transient-retry the seam uses. This is the most consequential drift: a single transient `gh` hiccup now strands the PR draft and exits non-zero — reintroducing exactly the flake-sensitivity this feature exists to eliminate. The promotion step must tolerate transient failures the same way run completion does.

The required end state is that recovery exercises the same gate-and-promote behavior as run completion (trailer-stamped fix commit, retry-wrapped promote, branch push semantics, branch-named still-dirty message), whether by reusing `runReadyGateWithTier` plus the retry-wrapped ready-half or by otherwise routing through the existing seam. Note the spec named `maybeMarkReady` as a reuse target, but its zero-subspec gate makes single-file specs never-promotable (conflicting with AC #6) — so reuse the *gate* half plus the retry-wrapped promote, keeping a completeness check that treats zero linked subspecs as complete. Full reimplementation is not acceptable; it has already diverged.

**2. The mutating acceptance criteria must be backed by tests; today they are ticked but unverified.**
AC #1 (green→ready), #2 (dirty-tree commit+push), #3 (all four red failure modes → draft + non-zero), #4 (`readyCommand` override honored), the incomplete/locked no-ops, and #6 (single-file spec promotable) are all marked `[x]` but have no test coverage. The only added tests cover refusal pre-checks (flag-without-name, unknown worktree, missing marker, no-PR, not-DRAFT). The cause is structural: the gate run and the `gh pr ready` call shell out with no injectable seam, so the mutating branches are unreachable in a unit test. Outcome 1's switch to the existing seam restores the stub points (`runReady`/`commitCheckFix`/`ghPrReady`/`markReady`-style seams) that make these paths testable. Either add tests that actually exercise the green path, the dirty-tree commit+push, each red failure mode, the override, and single-file promotion — or the ACs they cover must not be ticked. Ticking ACs whose behavior cannot be reached by a test is not defensible.

**3. Pre-check order must match the decision.**
The decision fixes the order as (a) PR exists, (b) PR is DRAFT, (c) spec complete. The code currently checks completeness first, so an operator hitting multiple failing pre-conditions sees the wrong refusal reason. Every branch still exits non-zero without mutating, so this is message fidelity, not safety — but reorder to match the decision.

### Non-blocking (apply if cheap, otherwise note)

- Lock-refusal output goes to stdout while every sibling refusal uses stderr — make it consistent.
- A malformed/unparseable lock file is swallowed and execution proceeds to mutate; fail-closed (refuse) is the safer default given this path now pushes. Defensible as-is given the single-operator invariant.
- cwd-based config-key resolution and the unparseable/no-task-list spec edge case are acceptable within the single-operator, well-formed-spec scope.

### Rationale

The intent is a low-friction *safe* recovery that promotes only verified-green work. Outcome 1 is the core: reimplementing the gate instead of reusing it both reintroduced the flake the feature targets (lost promote retry) and broke a repo-wide convention (lost trailer). Outcome 2 is correctness of the spec's own bookkeeping — ACs assert behavior that no test verifies and the current structure cannot verify. Outcome 3 is straightforward spec fidelity. The docs (run-loop, runbook, v1-behaviors) are accurate and need no further work.