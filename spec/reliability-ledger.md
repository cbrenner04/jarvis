# Harness reliability ledger

Reviewed 2026-10-02 (late) after the intent-split session (#4489–#4498). Companion to the [brief](./reliability-brief.md). Inventory: **0 open active spec plans, 33 ready-intents, 0 seeds**; `completed/` excluded. Every queue artifact appears once below. Chains read providers-first; plan each link against its merged predecessor.

## Operator features and ergonomics: ready-intents (1)

| Item | Chain | Scope |
| --- | --- | --- |
| [dependent-lane-rebase-after-predecessor-merge](./ready-intents/dependent-lane-rebase-after-predecessor-merge.md) | independent | Dependent fan-out lanes rebase onto `main` after the predecessor squash-merges. |

## Parked design and cleanup: ready-intents (19)

| Item | Chain | Scope |
| --- | --- | --- |
| [retire-run-pause](./ready-intents/retire-run-pause.md) | 1 of CLI retirement | `run pause`, TUI `pause`, `pauseController` go; `paused` status stays. |
| [retire-run-start](./ready-intents/retire-run-start.md) | after retire-run-pause | `run start`, `queuedInput`, write-loop rows; auto-start tests migrate to `run workflow`. |
| [retire-config-command](./ready-intents/retire-config-command.md) | independent | `config` goes; `set-agents` home decided in plan; smoke check re-pointed. |
| [merge-dismiss-undismiss-implementations](./ready-intents/merge-dismiss-undismiss-implementations.md) | independent | One dismissal implementation behind both verbs. |
| [align-dock-grammar-to-cli-verbs](./ready-intents/align-dock-grammar-to-cli-verbs.md) | after retire-run-pause | Dock accepts the CLI grammar minus `jarvis`. |
| [config-confinement-policy-type-and-cascade](./ready-intents/config-confinement-policy-type-and-cascade.md) | 1 of confinement | Named policy resolves per project with a machine default. |
| [adapter-confinement-translation-and-refusal](./ready-intents/adapter-confinement-translation-and-refusal.md) | after cascade | Adapters translate or refuse; defaults byte-identical. |
| [telemetry-confinement-recording](./ready-intents/telemetry-confinement-recording.md) | after adapters | Resolved policy and vendor mechanism on the telemetry row. |
| [shared-runtime-lives-under-v2-src](./ready-intents/shared-runtime-lives-under-v2-src.md) | 1 of shared fold | `shared/**` moves under `src`; imports and digest pathspec rewritten. |
| [shared-test-slices-fold-into-v2-slices](./ready-intents/shared-test-slices-fold-into-v2-slices.md) | after move | `test:shared` slices retire; root tests run in `v2` slices. |
| [move-v2-to-top-level](./ready-intents/move-v2-to-top-level.md) | after shared fold | `v2/` moves to the top level with scripts, CI scope, globs, `plan.targetDir`. |
| [remove-v2-language-from-docs](./ready-intents/remove-v2-language-from-docs.md) | after move | Prose and `v1-behaviors.md` tags stop saying `v2`. |
| [shared-git-operations-boundary](./ready-intents/shared-git-operations-boundary.md) | 1 of centralize | Typed Git operations with one owner in `shared/git.ts`. |
| [github-operations-boundary](./ready-intents/github-operations-boundary.md) | after git boundary | Typed `gh` PR operations with one owner. |
| [external-worktree-delegates-to-shared](./ready-intents/external-worktree-delegates-to-shared.md) | after git boundary | External worktree stops constructing Git commands. |
| [review-implement-uses-shared-diff](./ready-intents/review-implement-uses-shared-diff.md) | after git boundary | `branchDiff` delegates to the shared diff operation. |
| [root-scripts-use-shared-git](./ready-intents/root-scripts-use-shared-git.md) | after git boundary | `scripts/ready.ts` and peers delegate. |
| [cleanup-delegates-to-git-boundary](./ready-intents/cleanup-delegates-to-git-boundary.md) | after git + gh boundaries | Cleanup delegates Git and PR operations. |
| [guard-prevents-git-spawning-bypass](./ready-intents/guard-prevents-git-spawning-bypass.md) | after all migrations | Structural guard against new direct `git`/`gh` spawns. |

## Owner features — outside the backlog (6)

Added by the owner in #4419; split 2026-10-02. Plan on owner direction.

| Item | Chain | Scope |
| --- | --- | --- |
| [routing-action-catalog-and-validation](./ready-intents/routing-action-catalog-and-validation.md) | 1 of free-text | Closed action catalog and strict validation. |
| [routing-agent-role-and-tool-free-invocation](./ready-intents/routing-agent-role-and-tool-free-invocation.md) | after catalog | `routing` role, tool-free cheap-agent invocation. |
| [free-text-command-entry-and-dispatch](./ready-intents/free-text-command-entry-and-dispatch.md) | after role + git boundary | `jarvis "…"` dispatches through the same admission. |
| [seed-frontmatter-carries-risk-and-effort](./ready-intents/seed-frontmatter-carries-risk-and-effort.md) | 1 of selection | Validated `risk`/`effort` seed ratings. |
| [project-minimums-and-rating-pair-select-pipeline](./ready-intents/project-minimums-and-rating-pair-select-pipeline.md) | after frontmatter | Project floors and one pair-to-definition mapping. |
| [pipeline-start-admits-ratings-and-persists-selection](./ready-intents/pipeline-start-admits-ratings-and-persists-selection.md) | after mapping | `--risk`/`--effort`; admitted selection persisted and honored on resume. |

## Held: owner sign-off (6)

The toolset seed was marked not dispatchable; its split records the proposed direction and carries a hold line. Do not plan until the owner signs off.

| Item | Chain |
| --- | --- |
| [harness-tool-server-serves-role-scoped-tools](./ready-intents/harness-tool-server-serves-role-scoped-tools.md) | after shared-git-operations-boundary |
| [vendor-launch-disables-native-tools-or-refuses-role](./ready-intents/vendor-launch-disables-native-tools-or-refuses-role.md) | after tool server |
| [scoped-file-tools-refuse-out-of-scope-writes](./ready-intents/scoped-file-tools-refuse-out-of-scope-writes.md) | after tool server |
| [gate-tool-takes-gate-slot-lease](./ready-intents/gate-tool-takes-gate-slot-lease.md) | after tool server |
| [tick-blocker-token-move-into-tools](./ready-intents/tick-blocker-token-move-into-tools.md) | after tool server |
| [agent-shell-access-is-explicitly-bounded](./ready-intents/agent-shell-access-is-explicitly-bounded.md) | after the five above |

## Evidence-gated ready-intent (1)

| Item | Hold | Release condition |
| --- | --- | --- |
| [WAL lock-holder failure](./ready-intents/wal-lock-holder-child-survives-to-marker.md) | Do not plan or dispatch | An operator records a real rejection with exit code, signal, stderr tail, and source run. |

## Review caveats and follow-ups

- Cleanup archive publication (#4469): the staged-branch adoption seam is unused in production, so a leftover staged branch plus new archives in one run opens two same-titled PRs; only the last staged branch per project publishes per run; a staged branch with no managed worktree fails push every run.
- Cross-file mutant isolation (#4459): import reachability is static relative imports only (dynamic imports unseen).
- Review-feedback (#4461 #4473): refuses a non-draft lane PR without harness flip evidence (`review_feedback_pr_not_draft`); pipeline terminal `ready` re-readies a PR the operator drafted for review-feedback.
- Pipeline terminal publication cannot be re-run after a hand-merge (`pipeline resume` → `no_failed_stage`); the pipeline stays `failed` though its PR merged (01666fae, 133e8d8a).
- Prerequisite provenance markers (#4480) check split self-consistency only; a false `(already true: …)` passes — the plan-draft prerequisite gate is the backstop.
- Iteration-head guard (#4479) checks only settled iterations; timeout/abort/gate-budget-refused outcomes still checkpoint a rewritten lane.
- Lineage guard (#4416) does not fetch `pull/<n>/head`; a foreign closed PR whose head is not in the local object store stays blocked (safe, narrower than intended). No test for non-1 `merge-base` exit.
- Lane-PR settlement (#4375): closed-PR state is inferred from `prNumber` without `prUrl`; a closed lane still reaches terminal publication and fails "missing PR evidence" rather than "PR closed".
- Suite cap (#4407) does not apply to codex (shell calls not observable); documented in the runbook.
- Resume opt-in (#4409): falls silently to a no-op when `pipeline resume` falls back to reopen.
- Hand-authored splits (#4489–#4498): prerequisite markers that cross splits name an intent in another PR; the plan-draft prerequisite gate, not the split landing gate, verifies them.
