# Harness reliability ledger

Reviewed 2026-10-02 (evening) after the [2026-10-01/02 session](../../reports/20261002T055400Z-operator-reliability-backlog.md) and the 2026-10-02 day session. Companion to the [brief](./reliability-brief.md). Inventory: **0 open active spec plans, 1 ready-intent, 12 seeds**; `completed/` excluded. Every queue artifact appears once below.

## Immediate reliability: seed (1)

| Item | Next action | Remaining work and evidence |
| --- | --- | --- |
| [Review-feedback shrink uses lane spec](./seeds/review-feedback-shrink-uses-lane-spec.md) | Intent | Shrink gets the response sidecar as spec, inlines the repo, dies in ~10 s; 3/3 rounds 2026-10-02; fix stays unpushed. |

## Follow-on workflow quality: seed (1)

| Item | Next action / dependency | Remaining scope |
| --- | --- | --- |
| [Harness-run integration measurements](./seeds/implement-can-run-integration-slice-tests.md) | Intent | Observable harness execution for measurement criteria. |

## Operator features and ergonomics: seed (1)

| Item | Next action | Remaining scope |
| --- | --- | --- |
| [Serial chained fan-out](./seeds/pipeline-fan-out-lanes-serial-chained-bases.md) | Intent (per-lane settlement landed #4413 #4417) | Dependent-lane scheduling/base policy. Intent splits produced strict chains 4× on 2026-10-02 (approved head lanes only, by hand). |

## Parked design and cleanup: seeds (6)

| Item | Hold / dependency | Disposition |
| --- | --- | --- |
| [CLI retirement](./seeds/cli-retire-run-start-pause-and-config.md) | Unblocked: `run pause` retires (owner, 2026-10-02) | Original charter side item. |
| [CLI-aligned TUI grammar](./seeds/tui-dock-command-grammar-mirrors-cli.md) | After CLI retirement | Prefer after input-feedback repair. |
| [Confinement policy](./seeds/agent-confinement-is-per-vendor-and-unexpressed.md) | Per-project override seam landed (`projects.<key>.overrides`) | Single-operator legibility work. |
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
