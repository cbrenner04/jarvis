Verifying key codebase claims so the verdict is grounded in what's on disk.
# Verdict: required refinements

## 1. Formal prerequisites with daemon vs execution roles

Add a `## Prerequisites` section (not only inline prose) that mirrors the intent and states:

- **Daemon** (`daemon-drop-production-invert-hooks` merged): production modules carry no forbidden invert hooks; CLI tests must not import daemon setters.
- **Write-step rules**: comment-checkpoint guard-inversion contract is in effect.
- **Execution** (`execution-loop-drop-production-invert-hooks`): **not** a blocker for CLI production edits. Cross-surface `workflow.test.ts` cases name comment checkpoints on execution production guards and drop execution setter imports; CLI does not edit `external-worktree.ts`.

**Rationale:** Without this, implementers may block on execution merge, touch execution production code, or leave compile breaks when daemon parameters/setters are already gone.

---

## 2. Missing registry-release guard-inversion task

Tasks must cover all four invert-related cases in `workflow.test.ts`, including `inverting registry release before guarded kill commits kill after registry release` (`invertRegistryReleaseBeforeKill` on `settleKilledWorkflowOwnership` in daemon production code).

State ownership: daemon intent removes the parameter; this spec owns rewriting the CLI test to a comment checkpoint on the daemon guard (no setter, no parameter).

**Rationale:** Omission is a high-severity coverage gap — implementers can delete coverage or ship a compile break after the daemon prerequisite lands.

---

## 3. Agent-verifiable acceptance criteria

Reword criteria that require a historical pre-fix checkout:

- **AC1:** Require zero forbidden four-shape matches in `v2/src/commands/**/*.ts` outside `*.test.ts` in the worktree. Drop “fails against pre-fix code that still ships the hooks.”
- **Pre-admission pair:** Drop or replace AC2’s “fails against pre-fix setter-based invert” with a worktree-verifiable outcome (e.g. cited positive test stays green, or fold into the existing `(Manual)` inversion AC).

**Rationale:** Spec guidance requires non–human-only ACs to be satisfiable from the implement agent’s worktree; static enforcement script is not wired yet.

---

## 4. Guard-inversion and preservation coverage

**Comment-checkpoint contract:** Add a decision pointing implementers at `v2/docs/test-writing.md` (Guard-inversion evidence) and the daemon exemplar (`daemon-workflow-start.test.ts`). Clarify that checkpoints live in the pinning test while mutations target the owning production guard (including cross-surface cases).

**Duplicate detach client-wait guards:** Record that `workflow.ts` and `pipeline.ts` each have independent module variables — two separate checkpoints; removing hooks in only one module leaves debt.

**Preservation anchors:** Per refactor AC guidance, add cited “stays green” anchors for touched surfaces beyond the two already named — at minimum workflow detach, run-list filter/validation, cleanup socket paths, and pipeline applied/resumed positive paths (and `exitCodeForPipelineMutationOutcome` inlining if covered by existing tests).

**Rationale:** `test:v2` alone is a weak refactor contract; cited tests force verification against real pinning behavior. Tasks enumerate ~15 sites; ACs should not under-specify preservation or inversion contract.

---

## 5. Task wording: cleanup vs pipeline/workflow inversion patterns

Fix the task that says “drop invert-only `test()` blocks” so it distinguishes:

- **Pipeline/workflow:** dedicated `test("inverting …")` blocks with setter `afterEach` resets.
- **Cleanup / run-list:** mid-test setter toggles inside positive pinning tests.

Required outcome: remove setter usage and add comment checkpoints on the named production guard without deleting the wrong test structure.

**Rationale:** Miswording risks removing positive pinning tests instead of inverting guards.

---

## 6. `listRpcRequestIsFiltered` pinning scope

Tasks should name both pinning layers: handler-level positive (`dimension-only filtered query bypasses terminal retention` in `run-list-dimension-filters.test.ts`) and CLI integration positive (`run log stream-open and tui log tail-open accept dimension-listed runs beyond retention`), with the comment checkpoint on `listRpcRequestIsFiltered` in `run-list-rpc.ts`.

**Rationale:** The inversion test exercises the handler directly; both positives anchor the same guard at different layers.

---

## 7. Scope clarity: CLI production vs cross-surface test edits

Tighten opening prose or decisions to separate:

- **In scope (production):** forbidden hook removal in `v2/src/commands/**` non-test files.
- **In scope (tests only):** `workflow.test.ts` rewrites that checkpoint daemon/execution guards without editing those production modules.

Align with intent decision that cross-imported setters are removed with their owning surface, not re-exported or called from CLI tests.

**Rationale:** Resolves “CLI guards” ambiguity in the intent AC vs cross-surface test work.

---

## Not required: subspec split

Keep a single subspec for the `cli` module boundary. The work shares one forbidden-shape contract, one rewrite pattern, and one verification gate (`test:v2`); per-file splits would leave the surface in a mixed hook/no-hook state without independent operator value. Cross-surface `workflow.test.ts` work is sequencing and task-completeness, not grounds for five subspecs — provided refinements 1–2 land.

---

## Summary

The spec is directionally correct and aligned with the ready-intent and sibling daemon/execution intents. **Refine before merge:** formal prerequisites (daemon hard, execution soft), complete task list including registry-release, agent-verifiable AC wording, comment-checkpoint/preservation/decision gaps, and accurate cleanup vs dedicated-invert-test task wording. No structural rethink or subspec fan-out required.