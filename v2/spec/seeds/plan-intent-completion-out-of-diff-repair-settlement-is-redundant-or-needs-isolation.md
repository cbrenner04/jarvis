---
name: plan-intent-completion-out-of-diff-repair-settlement-is-redundant-or-needs-isolation
---

# Markdown-only out-of-diff repair-fence settlement is redundant with existing attributable settlement — or its tests never isolate it

## Problem

The spec-only-diff work (2026-08-07) proposed a second guard, `shouldSettleMarkdownOnlyOutOfScopeRepair` in `publishWithReadyRepair`, to settle `ready_gate_out_of_scope` (instead of `completion_commit_failed`) when a markdown-only plan/intent completion's gate failure is fully outside the run diff and repair would stage only non-markdown paths. Implementation stranded and the **test-scope half shipped alone** (#2712); this settlement half was dropped because it could not be shown to do anything:

1. **Redundant for everything tested.** Disabling the new guard entirely leaves both drafted settlement regressions GREEN — the pre-existing attributable-untouched-path settlement already returns `ready_gate_out_of_scope` (fixCalls=0, no repair) for the exact inputs the tests build. The guard's claimed unique value (settling when `classifyReadyGatePublishFailure` left `ready_gate_failed` via `baseRefProbeError`) is never isolated by a test.
2. **Hollow checkpoints.** Both mutation checkpoints (`return findFirstMarkdownOnlyFenceViolation(...) !== undefined;` -> `return false;`) left the scoped suite green — the harness artifact-contract check wrote a `## Blocker` saying so. The keystone directive `shouldSettleMarkdownOnlyOutOfScopeRepair(` matched BOTH the function definition and its call site, so applying it produced a compile error (file fails to build) and false-reddened via `1 error` rather than a behavioral catch; mutating only the call site left the test GREEN.

## Evidence

- 2026-08-07: implement run `40115b8e` settled `iteration_commit_failed` (a `noExcessiveCognitiveComplexity` biome error in `publishWithReadyRepair`); subspec carried a harness `## Blocker` for the two hollow checkpoints while all AC were ticked. Subagent review confirmed redundancy + false-redden. Operator shipped only the ci-test-scope change (#2712) and re-scoped this half.

## Decisions

- First determine whether the guard is needed AT ALL: construct a completion whose gate failure leaves `ready_gate_failed` (e.g. `baseRefProbeError` path) with fully-outside-diff non-markdown repair, and check whether the existing attributable-untouched-path settlement already returns `ready_gate_out_of_scope`. If it does for all reachable markdown-only cases, DROP the guard as dead code — do not add it.
- If a reachable case exists where the existing settlement does NOT fire and a `completion_commit_failed` strand results, add the guard, but its regression MUST isolate it: the test must fail when the guard is removed (not pass via the pre-existing path). Keystone/mutation directives MUST target a string unique to the semantically meaningful call site, never one that also matches the function definition (which false-reddens via compile error).

## Acceptance criteria

- [ ] A test constructs a markdown-only plan (and intent) completion whose gate failure is fully outside the run diff on a `ready_gate_failed`-leaving path and asserts the CURRENT (pre-guard) settlement outcome; if it is already `ready_gate_out_of_scope`, the guard is proven redundant and no guard is added (documented). If it strands, the guard is added and this test fails when the guard is removed.
- [ ] If a guard is added, its mutation checkpoint directive is unique to the call site (includes an argument token) and hand-verified to redden BEHAVIORALLY (a failed assertion, not a compile error), with the criterion naming the enclosing test verbatim.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — only if a guard ships; otherwise none.
