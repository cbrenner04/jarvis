Verifying key technical claims in the codebase so the verdict is grounded in the actual code.
## Verdict: required refinements

### 1. Markdown-only outside-diff fixture contract

The spec must state that plan and intent isolation regressions use iteration commits that change **only** markdown/plan-stage paths, with gate failure on a path **outside** both `markdownOutputRoots` **and** the run diff. The named `initPlanRepairFenceWorktree` / `initIntentRepairFenceWorktree` helpers currently stage non-markdown paths in the iteration commit, so reusing them without a markdown-only variant would exercise markdown-fence `completion_commit_failed` (the existing `ready-gate repair fence` seam), not `publishWithReadyRepair` settlement. The spec must require explicit overrides: `gateFailurePath` away from markdown defaults, `lintMdOnly: false`, and `gateFailureOutput` on the outside-diff path.

### 2. Seam choice per discovery branch

`baseRefProbeFailsSeam` reproduces the failure at base ref and settles `ready_gate_out_of_scope` **before** repair — it is not a `ready_gate_failed`-leaving seam. The spec must separate seam choice by outcome:

- **Redundancy discovery:** `baseRefProbeFailsSeam` (or equivalent early out-of-scope settlement).
- **Guard-needed discovery:** swap to a seam that leaves `ready_gate_failed` so repair runs before settlement (e.g. the base-ref probe error/pass pattern from existing `write-loop.test.ts` coverage).

Intent prose that groups `baseRefProbeFailsSeam` with `ready_gate_failed`-leaving seams must be corrected. Default seam language must not invite wiring that skips repair on the guard path.

### 3. Self-referential and conditional acceptance criteria

An AC that grades subspec decision-ledger prose is self-referential and must be removed. Redundancy is proven by tests asserting `ready_gate_out_of_scope` with **no** production guard added. Guard-branch ACs (pre-fix failing test, mutation checkpoint, keystone) must be explicitly **N/A** when discovery selects redundancy, so implement runs cannot over-tick or strand on inapplicable criteria.

### 4. Observable assertions, not “baseline outcome” vagueness

ACs must assert the observed `result.kind` explicitly once discovery runs (expected redundancy: `ready_gate_out_of_scope`). When settlement is out-of-scope, ACs must also assert absence of `ready_gate_repair` events (matching `untouched-path gate settlement` and the task checklist). Intent parity must be defined as same `result.kind` and matching repair telemetry, not only “parity with plan regression.”

### 5. Discovery failure handling

If baseline settlement is neither `ready_gate_out_of_scope` nor `completion_commit_failed`, the spec must require appending a `## Blocker` and stopping — discovery failed.

### 6. Task checklist implementability

Tasks must name the harness entry points: `runRepairFenceLoop` with `planRepairLoopDefaults` / `intentRepairLoopDefaults` (or equivalent `landing` / `specPath` / `markdownOutputRoots`). They must include an explicit discovery procedure (run regressions on baseline → record outcome → branch). Repair-edit requirements must differ by branch: no repair edit when redundancy settles early; non-markdown repair edit when the guard path requires repair before settlement.

### 7. Preservation vs behavior-change AC shape

On the redundancy path, ACs should cite the new pinning tests as preservation anchors (characterization, not failing-test-first). On the guard path, retain a failing-test AC naming the plan regression, plus mutation and keystone checkpoints with call-site-unique `// @mutate` directives — deferred directive text is acceptable at draft time, but guard-branch criteria must not be tickable until those directives exist.

### 8. Intent–subspec alignment

`intent.md` must align with the subspec on: corrected seam terminology, split plan/intent ACs, guard-conditional ACs, and documentation updates (none when redundant; operator-runbook + v1-behaviors only when guard ships).

### Rationale

Without fixture and seam corrections, isolation regressions cannot falsify the #2712 redundancy hypothesis and may falsely indicate “guard needed” via markdown-fence refusal. Without AC mutual exclusivity and test-anchored redundancy proof, the spec violates spec-guidance rules on self-referential criteria, preservation vs new-behavior ACs, and conditional checkpoint contracts. Task and intent alignment closes implementability gaps the advocate confirmed in code review.

**No subspec split required** — one atomic subspec with two conditional outcomes remains appropriate once the above contracts are explicit.