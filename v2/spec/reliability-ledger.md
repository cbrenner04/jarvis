# Harness reliability ledger

Reviewed 2026-10-02 after the [2026-10-01/02 session](../../reports/20261002T055400Z-operator-reliability-backlog.md). Companion to the [brief](./reliability-brief.md). Inventory: **5 active spec plans, 2 ready-intents, 21 seeds**; `completed/` excluded. Every queue artifact appears once below.

## Highest priority: active spec (1)

| Item | Next action | Remaining work and evidence |
| --- | --- | --- |
| [Workflow terminal evidence waits for every row](./20261002T061748Z-workflow-terminal-waits-for-all-rows/index.md) | Implement in flight (`0f5274bf`) | The invocation finally path writes a settled marker even while a linked row remains non-terminal, producing a false finished incident. Siblings merged #4429 #4430 #4432. |

## Immediate reliability: active specs (4), ready-intent (1), seeds (3)

| Item | Next action / dependency | Remaining work and evidence |
| --- | --- | --- |
| [Finalization gates share the gate slot](./20261001T193311Z-finalization-ready-gates-share-the-gate-slot/index.md) | Implement in flight (`c6030e65`; lane hand-rebased past #4428) | 00 at 2/3. Concurrent gates false-redded every lane under load; repair then edited unrelated files. |
| [Ready-repair prompt lists allowed paths](./20261001T193407Z-ready-repair-prompt-allowed-paths/index.md) | After gate-slot | Shares new `write-loop-ready-repair.test.ts` with event-context: serial. |
| [`ready_gate_repair` logs gate context](./20261001T193416Z-ready-gate-repair-event-gate-context/index.md) | After allowed-paths | Failing step + 4 KiB tail on the event. |
| [Revert write-step history rewrite](./20261001T193533Z-revert-write-step-history-rewrite/index.md) | After event-context | Repair agent rebased a lane onto `origin/main`; publisher then refused its own tip (2026-10-01). |
| [Implement rules forbid history rewrite](./ready-intents/implement-rules-forbid-history-rewrite.md) | After revert lane | Prompt rule; one-line change plus render tests. |
| [Mutation candidates isolated across files](./seeds/mutation-candidates-isolated-across-files.md) | Intent | Concurrent cross-file mutants contaminate killing sets (false non-terminating on `ready-finalize.ts:1470`, 2026-10-02 gate-slot lane). |
| [Shrink failure status matches resume](./seeds/shrink-invocation-failure-status-matches-resume.md) | Intent | Shrink `invocation_failure` settles `paused` but resume refuses → stuck row (run `3dd4be83`, 2026-10-02). |
| [Hung killing test kills the mutant](./seeds/hung-killing-test-counts-as-killed.md) | Intent | Per-test timeout == kill floor (30 s), so a test hanging under a mutant strands `non_terminating_mutation_failed`; hand-fixed twice on the gate-slot lane 2026-10-02. |

## Follow-on workflow quality: seeds (7)

| Item | Next action / dependency | Remaining scope |
| --- | --- | --- |
| [Target-repo documentation layout](./seeds/implement-respects-target-repo-doc-layout.md) | Intent; #3426 | Inject guidance; use the target's doc layout. |
| [Sibling-repo prerequisite coverage](./seeds/intent-split-covers-sibling-repo-surfaces.md) | Intent; #3439 | Split-internal prerequisite coverage check. |
| [Detached ready-intent consumption](./seeds/detached-pipeline-plan-stage-consumes-ready-intents.md) | Intent; #3041 | Re-scoped 2026-10-02 to cleanup pruning on plan-spec landing (consume-from-source plan rejected, #4448). |
| [Per-project configuration seam](./seeds/per-project-config-overrides-seam.md) | Intent; #3026 / #3150 | Bounded agent-order and idle-timeout overrides resolved once at admission. |
| [Review-feedback matches linked lanes](./seeds/review-feedback-matches-linked-implement-lanes.md) | Intent | `review-feedback --branch` refused a linked implement lane (PR on review row only); #4440 hand-fixed. |
| [Review-feedback captures review bodies](./seeds/review-feedback-captures-review-bodies.md) | Intent | Review bodies dropped; `--address-review` on #4459 completed `no-work` in 9 s. |
| [Harness-run integration measurements](./seeds/implement-can-run-integration-slice-tests.md) | Intent | Observable harness execution for measurement criteria. |

## Operator features and ergonomics: seeds (2)

| Item | Next action | Remaining scope |
| --- | --- | --- |
| [Cleanup opens the archive PR](./seeds/cleanup-opens-archive-pr.md) | Intent | Two unpushed `cleanup/archive-*` branches stranded 16 specs (hand-fixed #4420). |
| [Serial chained fan-out](./seeds/pipeline-fan-out-lanes-serial-chained-bases.md) | Intent (per-lane settlement landed #4413 #4417) | Dependent-lane scheduling/base policy. Intent splits produced strict chains 3× this session (gate-slot folded by hand, #4387). |

## Parked design and cleanup: seeds (6)

| Item | Hold / dependency | Disposition |
| --- | --- | --- |
| [CLI retirement](./seeds/cli-retire-run-start-pause-and-config.md) | Unblocked: `run pause` retires (owner, 2026-10-02) | Original charter side item. |
| [CLI-aligned TUI grammar](./seeds/tui-dock-command-grammar-mirrors-cli.md) | After CLI retirement | Prefer after input-feedback repair. |
| [Confinement policy](./seeds/agent-confinement-is-per-vendor-and-unexpressed.md) | Per-project override seam | Single-operator legibility work. |
| [Fold shared runtime](./seeds/fold-shared-into-v2.md) | Low priority | After runtime reliability settles. |
| [Retire v2 naming](./seeds/retire-v2-nomenclature.md) | After shared-runtime fold | Unrelated to the old charter. |
| [Harness-owned agent tools](./seeds/harness-exposes-agent-toolset.md) | Explicit owner sign-off | Updated by owner #4419. Do not dispatch. |

## Parked owner seeds — outside the backlog (3)

Added by the owner in #4419; not part of this reliability target. Do not dispatch without owner direction: [Centralize deterministic operations](./seeds/centralize-deterministic-operations.md), [Free-text command routing](./seeds/free-text-command-routing.md), [Pipeline selection by risk and effort](./seeds/pipeline-selection-risk-effort.md).

## Evidence-gated ready-intent (1)

| Item | Hold | Release condition |
| --- | --- | --- |
| [WAL lock-holder failure](./ready-intents/wal-lock-holder-child-survives-to-marker.md) | Do not plan or dispatch | An operator records a real rejection with exit code, signal, stderr tail, and source run. |

## Review caveats and follow-ups

- Lineage guard (#4416) does not fetch `pull/<n>/head`; a foreign closed PR whose head is not in the local object store stays blocked (safe, narrower than intended). No test for non-1 `merge-base` exit.
- Lane-PR settlement (#4375): closed-PR state is inferred from `prNumber` without `prUrl`; a closed lane still reaches terminal publication and fails "missing PR evidence" rather than "PR closed".
- Suite cap (#4407) does not apply to codex (shell calls not observable); documented in the runbook.
- Resume opt-in (#4409): falls silently to a no-op when `pipeline resume` falls back to reopen.
