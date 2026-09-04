# Structural-invariant test audit

Durable artifact for discovering, classifying, and re-keying structural-invariant tests under `v2/src/**` and `shared/**`. Inventory rows from subspecs 01–04 append below the candidate manifest.

## Methodology

### In-scope tests

Co-located `*.test.ts` files under `v2/src/**` and `shared/**` whose anchors pin invariants to incidental structure rather than observable behavior. Discovery is mechanical: `scripts/discover-structural-invariant-tests.ts` emits one candidate row per file. A file is `in-scope` when any discovery rule matches; otherwise `out-of-scope` with rationale `no-structural-signal`.

### Excluded trees

- `v1/**` — maintenance-only fallback; out of v2 audit scope.
- `scripts/**` — harness tooling, not co-located production tests.
- `test/**` — root harness tests, not co-located under `v2/src` or `shared`.
- Fixture-only reads inside otherwise in-scope files — dispositioned per anchor at inventory time; the script may still mark the file `in-scope` when another rule matches.
- `*.test-support.ts` — support modules, not test entrypoints.

### Discovery rules

Rule priority when multiple match: `source-read` > `registry-mirror` > `structural-name`.

- **source-read** — references `readFileSync`, `readFile(`, `git show`, or `merge-base` against a committed production path (not fixture-only reads).
- **registry-mirror** — declares a hardcoded array/object literal with an inventory-style name (`PERMITTED_*`, `*_REGISTRY`, `*_FILES`, `SOURCE_BUCKETS`, …). Rule B may over-include; disposition at inventory time.
- **structural-name** — filename matches `inventory`, `structure`, `guard`, `boundary`, or `parity`.

Re-run: `bun run scripts/discover-structural-invariant-tests.ts`

### Inventory output schema

One row per anchor (not per file when mixed): `row-id`, `test-path`, `case-scope`, `guarded-invariant`, `anchor-mechanism`, `classification` (`behavioral` | `incidental`), `disposition` (`re-key` | `stay-incidental` | `n/a`), `stay-incidental-rationale` (required when `stay-incidental`), `vacuous-pass-risk` (`yes` | `no` when mechanism is one-way absence or can pass vacuously).

### Classification rubric

- **behavioral** — invariant still holds after sound rename/move/reorder without changing observable test outcome.
- **incidental** — anchor is symbol name, line number, hand-maintained file list, copied registry literal, or one-way absence without paired presence check. Baseline: `v2/spec/seeds/structural-invariants-key-on-behavior-not-incidental-structure.md` when present.

Incidental rows default to `re-key`. `stay-incidental` requires a one-line rationale naming why the anchor cannot track the source of truth.

### Manifest reconciliation

Completeness is script output reconciliation: every `in-scope` file has ≥1 inventory row; every inventory row cites a file the script emitted `in-scope`. Re-run the script after discovery-rule changes and refresh the embedded manifest below.

## Candidate manifest

Verbatim stdout from `bun run scripts/discover-structural-invariant-tests.ts`:

```
test-path scope rule
shared/executable-tree.test.ts out-of-scope no-structural-signal
shared/git.test.ts out-of-scope no-structural-signal
shared/intent-stage.test.ts out-of-scope no-structural-signal
shared/invocation/agents.test.ts out-of-scope no-structural-signal
shared/invocation/claude-json.test.ts out-of-scope no-structural-signal
shared/invocation/cursor-json.test.ts out-of-scope no-structural-signal
shared/invocation/execute.test.ts out-of-scope no-structural-signal
shared/invocation/session-log.test.ts out-of-scope no-structural-signal
shared/is-record.test.ts out-of-scope no-structural-signal
shared/linked-subspec-routing.test.ts out-of-scope no-structural-signal
shared/module-boundary-surfaces.test.ts in-scope structural-name
shared/mutation-checkpoint-criteria.test.ts out-of-scope no-structural-signal
shared/preload.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
shared/prices/cost.test.ts out-of-scope no-structural-signal
shared/prices/load.test.ts out-of-scope no-structural-signal
shared/project-safe-id.test.ts out-of-scope no-structural-signal
shared/prompts/assemble.test.ts out-of-scope no-structural-signal
shared/prompts/intent-split.test.ts out-of-scope no-structural-signal
shared/prompts/no-prompt-surgery-guard.test.ts in-scope registry-mirror
shared/prompts/plan-draft.test.ts out-of-scope no-structural-signal
shared/prompts/registry.test.ts out-of-scope no-structural-signal
shared/prompts/render.test.ts out-of-scope no-structural-signal
shared/prompts/review-implement-contract-preservation.test.ts in-scope source-read
shared/prompts/review-implement-growth-budget.test.ts out-of-scope no-structural-signal
shared/prompts/review-implement.test.ts in-scope source-read
shared/prompts/review-plan-contract-preservation.test.ts out-of-scope no-structural-signal
shared/prompts/review-plan-growth-budget.test.ts out-of-scope no-structural-signal
shared/prompts/review-plan-hollow-pin.test.ts out-of-scope no-structural-signal
shared/prompts/review-plan-premise-falsification.test.ts out-of-scope no-structural-signal
shared/prompts/review-profile.test.ts out-of-scope no-structural-signal
shared/prompts/review-prompt-divergence.test.ts in-scope source-read
shared/prompts/step-rules.test.ts out-of-scope no-structural-signal
shared/publication-input-consumption.test.ts out-of-scope no-structural-signal
shared/shrink-step-id.test.ts out-of-scope no-structural-signal
shared/spec-parser.test.ts out-of-scope no-structural-signal
shared/subprocess.test.ts out-of-scope no-structural-signal
shared/worktree-lock.test.ts out-of-scope no-structural-signal
v2/src/cli.test.ts out-of-scope no-structural-signal
v2/src/cli/help-flags-parity.test.ts in-scope structural-name
v2/src/cli/stale-dispatch.test.ts out-of-scope no-structural-signal
v2/src/commands/cleanup-artifacts.test.ts out-of-scope no-structural-signal
v2/src/commands/cleanup-cli.test.ts out-of-scope no-structural-signal
v2/src/commands/cleanup.test.ts out-of-scope no-structural-signal
v2/src/commands/config.test.ts in-scope source-read
v2/src/commands/daemon.test.ts out-of-scope no-structural-signal
v2/src/commands/eligibility-gate.test.ts out-of-scope no-structural-signal
v2/src/commands/init.test.ts out-of-scope no-structural-signal
v2/src/commands/pipeline-start-admission.test.ts out-of-scope no-structural-signal
v2/src/commands/pipeline.test.ts out-of-scope no-structural-signal
v2/src/commands/run-list-dimension-filters.test.ts out-of-scope no-structural-signal
v2/src/commands/run-list-query-limit-cap.test.ts out-of-scope no-structural-signal
v2/src/commands/run-list-since-queries-history.test.ts out-of-scope no-structural-signal
v2/src/commands/run.test.ts out-of-scope no-structural-signal
v2/src/commands/stale-reset-workspace.test.ts out-of-scope no-structural-signal
v2/src/commands/tui.test.ts out-of-scope no-structural-signal
v2/src/commands/workflow-start-preparation.test.ts in-scope source-read
v2/src/commands/workflow.test.ts in-scope source-read
v2/src/config/agent-model-config.test.ts out-of-scope no-structural-signal
v2/src/config/machine-config-loader.test.ts out-of-scope no-structural-signal
v2/src/config/machine-profile-loader.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-ipc-responsiveness.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-pipeline-approval.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-pipeline-dismiss.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-pipeline-handlers.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-pipeline-observation.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-pipeline-recover.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-pipeline-resume.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-pipeline-start.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-process-log.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-queue-promotion.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-ready-gate-orphan-sweep.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-reconciliation.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-registry.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-resume.test.ts in-scope source-read
v2/src/daemon/daemon-retire-superseded.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-run-control-context.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-run-control-handler-guard.test.ts in-scope registry-mirror
v2/src/daemon/daemon-run-dismiss.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-run-failure-capture.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-run-lifecycle-handlers.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-start-list.test.ts in-scope source-read
v2/src/daemon/daemon-state-store-lock-timeout.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-tail-stream.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-terminal-run-retention.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-test-inventory.test.ts in-scope source-read
v2/src/daemon/daemon-test-lifecycle.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-wait-run-completion.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-wire.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-workflow-admission-handlers.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-workflow-start.test.ts in-scope source-read
v2/src/daemon/daemon.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/daemon/keyed-daemon-coexistence.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/daemon/live-daemon-socket-discovery.test.ts out-of-scope no-structural-signal
v2/src/daemon/memory-watermark.test.ts out-of-scope no-structural-signal
v2/src/daemon/operator-incidents.test.ts out-of-scope no-structural-signal
v2/src/daemon/operator-notification-sweep.test.ts out-of-scope no-structural-signal
v2/src/daemon/operator-notification.test.ts out-of-scope no-structural-signal
v2/src/daemon/pipeline-chained-workflow-deps.test.ts out-of-scope no-structural-signal
v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/daemon/pipeline-execution.test.ts out-of-scope no-structural-signal
v2/src/daemon/pipeline-stage-dispatch.test.ts out-of-scope no-structural-signal
v2/src/daemon/pipeline-stage-recovery.test.ts out-of-scope no-structural-signal
v2/src/daemon/pipeline-stage-resolve.test.ts out-of-scope no-structural-signal
v2/src/daemon/pipeline-workflow-preparation-parity.test.ts in-scope structural-name
v2/src/daemon/run-operator-error.test.ts out-of-scope no-structural-signal
v2/src/daemon/workflow-invocation-live.test.ts out-of-scope no-structural-signal
v2/src/daemon/workflow-list-snapshot.test.ts out-of-scope no-structural-signal
v2/src/daemon/write-loop-binding-source-guard.test.ts in-scope source-read
v2/src/daemon/write-loop-codex-sandbox-mode.test.ts out-of-scope no-structural-signal
v2/src/execution/completion-commit.test.ts in-scope source-read
v2/src/execution/completion-publisher.test.ts out-of-scope no-structural-signal
v2/src/execution/diff-derived-mutation-verifier.test.ts in-scope source-read
v2/src/execution/execution-terminal-settlement-guard.test.ts in-scope source-read
v2/src/execution/external-worktree.test.ts out-of-scope no-structural-signal
v2/src/execution/implement-spec-landing.test.ts out-of-scope no-structural-signal
v2/src/execution/implement-workflow-steps.test.ts out-of-scope no-structural-signal
v2/src/execution/intent-output.test.ts out-of-scope no-structural-signal
v2/src/execution/intent-run-body-summary.test.ts out-of-scope no-structural-signal
v2/src/execution/intent-split-regression.test.ts in-scope registry-mirror
v2/src/execution/intent-workflow-steps.test.ts out-of-scope no-structural-signal
v2/src/execution/pipeline-definition-validation.test.ts out-of-scope no-structural-signal
v2/src/execution/pipeline-posture-cli-alignment.test.ts out-of-scope no-structural-signal
v2/src/execution/pipeline-registry.test.ts out-of-scope no-structural-signal
v2/src/execution/plan-workflow-steps.test.ts out-of-scope no-structural-signal
v2/src/execution/pr-attribution.test.ts out-of-scope no-structural-signal
v2/src/execution/pr-body-refresh.test.ts out-of-scope no-structural-signal
v2/src/execution/project-pipeline-resolution.test.ts out-of-scope no-structural-signal
v2/src/execution/publication-landing.test.ts out-of-scope no-structural-signal
v2/src/execution/publication-retry.test.ts out-of-scope no-structural-signal
v2/src/execution/publication-spec-path.test.ts out-of-scope no-structural-signal
v2/src/execution/publication-workflow-steps.test.ts out-of-scope no-structural-signal
v2/src/execution/ready-finalize.test.ts in-scope source-read
v2/src/execution/review-cycle.test.ts out-of-scope no-structural-signal
v2/src/execution/review-debate.test.ts out-of-scope no-structural-signal
v2/src/execution/review-intent-enforcement.test.ts out-of-scope no-structural-signal
v2/src/execution/review-role-invocation.test.ts out-of-scope no-structural-signal
v2/src/execution/runtime-smoke-verifier.test.ts out-of-scope no-structural-signal
v2/src/execution/spec-creation-title.test.ts out-of-scope no-structural-signal
v2/src/execution/spec-run-body-summary.test.ts out-of-scope no-structural-signal
v2/src/execution/staged-markdown-lint.test.ts out-of-scope no-structural-signal
v2/src/execution/step-runner.test.ts out-of-scope no-structural-signal
v2/src/execution/successor-step-idle-watchdog.test.ts out-of-scope no-structural-signal
v2/src/execution/terminal-publication.test.ts out-of-scope no-structural-signal
v2/src/execution/uncovered-changed-lines.test.ts out-of-scope no-structural-signal
v2/src/execution/workflow-loader.test.ts out-of-scope no-structural-signal
v2/src/execution/workflow-runner-core.test.ts in-scope source-read
v2/src/execution/workflow-runner-debate-landing-structure.test.ts in-scope source-read
v2/src/execution/workflow-runner-debate-landing.test.ts out-of-scope no-structural-signal
v2/src/execution/workflow-runner-debate.test.ts in-scope source-read
v2/src/execution/workflow-runner-intent.test.ts out-of-scope no-structural-signal
v2/src/execution/workflow-runner-plan.test.ts out-of-scope no-structural-signal
v2/src/execution/workflow-runner-publication.test.ts in-scope source-read
v2/src/execution/workflow-runner-resume-inventory.test.ts in-scope source-read
v2/src/execution/workflow-runner-resume-structure.test.ts in-scope source-read
v2/src/execution/workflow-runner-resume.test.ts out-of-scope no-structural-signal
v2/src/execution/workflow-runner-review-standard.test.ts out-of-scope no-structural-signal
v2/src/execution/workflow-runner-review.test.ts out-of-scope no-structural-signal
v2/src/execution/workflow-runner-validation.test.ts out-of-scope no-structural-signal
v2/src/execution/workflow-runner.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop-dirty-completion.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop-idle-watchdog.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop-input.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop-intent-landing.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop-ready-gate-reap.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop-session-log.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop-staged-markdown-lint.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop-timeout.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop.test.ts in-scope source-read
v2/src/execution/write-prompt.test.ts out-of-scope no-structural-signal
v2/src/execution/write.test.ts out-of-scope no-structural-signal
v2/src/export-surface-trim.test.ts out-of-scope no-structural-signal
v2/src/ipc/ipc.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/ipc/rpc-transport.test.ts out-of-scope no-structural-signal
v2/src/paths.test.ts out-of-scope no-structural-signal
v2/src/persistence/log-stream.test.ts out-of-scope no-structural-signal
v2/src/persistence/pipeline-stage-settlement.test.ts out-of-scope no-structural-signal
v2/src/persistence/state-store-baseline-migration.test.ts out-of-scope no-structural-signal
v2/src/persistence/state-store-on-disk.test.ts out-of-scope no-structural-signal
v2/src/persistence/state-store-wal-concurrency.test.ts out-of-scope no-structural-signal
v2/src/persistence/state-store-wal-open.test.ts out-of-scope no-structural-signal
v2/src/persistence/state-store.test.ts out-of-scope no-structural-signal
v2/src/persistence/workflow-run-status-rollup.test.ts out-of-scope no-structural-signal
v2/src/testing/bounded-microtask-spin.test.ts out-of-scope no-structural-signal
v2/src/testing/preload.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/testing/timer-callback-guard-fixture.test.ts in-scope structural-name
v2/src/testing/workflow-step-fixtures.test.ts out-of-scope no-structural-signal
v2/src/tui/tui-attention-rows.test.ts out-of-scope no-structural-signal
v2/src/tui/tui-command-parser.test.ts out-of-scope no-structural-signal
v2/src/tui/tui-daemon-client.test.ts out-of-scope no-structural-signal
v2/src/tui/tui-elapsed-format.test.ts out-of-scope no-structural-signal
v2/src/tui/tui-log-tail-client.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/tui/tui-log-tail-client.test.ts out-of-scope no-structural-signal
v2/src/tui/tui-monitor-lines.test.ts out-of-scope no-structural-signal
v2/src/tui/tui-monitor-pipeline-tree.test.ts out-of-scope no-structural-signal
v2/src/tui/tui-monitor-terminal-window.test.ts out-of-scope no-structural-signal
v2/src/tui/tui-monitor-workflow-collapse.test.ts out-of-scope no-structural-signal
v2/src/tui/tui-shell-layout.test.ts out-of-scope no-structural-signal
v2/src/tui/tui-timestamp-format.test.ts out-of-scope no-structural-signal
```

## Shared inventory

| row-id | test-path | case-scope | guarded-invariant | anchor-mechanism | classification | disposition | stay-incidental-rationale | vacuous-pass-risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| shr-mbs-surfaces-registry | shared/module-boundary-surfaces.test.ts | module boundary surfaces > classifies committed phrases | `MODULE_BOUNDARY_SURFACES` lists persistence, daemon, cli, execution-loop | hardcoded array equality against imported export | incidental | re-key | | |
| shr-mbs-split-emitted-files | shared/module-boundary-surfaces.test.ts | module boundary surfaces > normalizes the * staged tree without provenance | multi-boundary split emits manifest-declared child filenames | `manifest.json` `expectedChildren.file` list equality on `readdirSync` filter | incidental | re-key | | |
| shr-mbs-split-index-links | shared/module-boundary-surfaces.test.ts | module boundary surfaces > normalizes the * staged tree without provenance | index checklist links match emitted child files | same manifest file list reused for `indexChecklistFiles` equality | incidental | re-key | | |
| shr-mbs-split-section-bullets | shared/module-boundary-surfaces.test.ts | module boundary surfaces > normalizes the * staged tree without provenance | preserved Decisions/Acceptance/Documentation bullets match manifest child arrays | per-section `child[section.key]` equality against emitted subspec bodies | incidental | re-key | | |
| shr-mbs-manifest-union | shared/module-boundary-surfaces.test.ts | module boundary surfaces > normalizes the * staged tree without provenance | surviving parent section bullets equal union of child section bullets | `assertManifestUnion` compares fixture parent read to manifest `expectedChildren` union | incidental | re-key | | |
| shr-mbs-k4-cli-first-filename | shared/module-boundary-surfaces.test.ts | module boundary surfaces > inverting draft dependency order guard fails k4 | k4 dependency order emits CLI surface file before persistence | hardcoded `emittedFiles[0] === "00-cli.md"` filename pin | incidental | re-key | | |
| shr-npsg-assembly-paths | shared/prompts/no-prompt-surgery-guard.test.ts | prompt assembly builders omit post-render string surgery | listed assembly sources contain no forbidden prompt-surgery constructs | hand-maintained `GUARDED_ASSEMBLY_PATHS` list driving `readFileSync` scans | incidental | re-key | | |
| shr-npsg-forbidden-tokens | shared/prompts/no-prompt-surgery-guard.test.ts | prompt assembly builders omit post-render string surgery | forbidden constructs are strip/replace call shapes | hand-maintained `FORBIDDEN_PROMPT_SURGERY_TOKENS` literal list | incidental | re-key | | |
| shr-ricp-contract-markers | shared/prompts/review-implement-contract-preservation.test.ts | implement review role contract preservation > implement review role contract substrings preserved | implement review roles preserve merge-base diff instructions and role-specific contract phrases; critic omits adversary identify checklist | `MERGE_BASE_DIFF_MARKERS` and role contract substring presence; `ADVERSARY_IDENTIFY_LIST_MARKERS` one-way `.not.toContain` on registry bodies | incidental | re-key | | yes |
| shr-ri-merge-base-prose | shared/prompts/review-implement.test.ts | renderPatchReviewCriticPrompt branch diff > renders stat, changed paths, and merge-base unified diff for critic and debate roles | critic and debate roles render merge-base diff provenance wording | substring pins for `merge-base branch diff`, `git merge-base <base> HEAD`, `git diff <mergeBase> HEAD`, and `.not.toContain("not a unified diff")` | incidental | re-key | | yes |
| shr-rpd-patch-implement-divergence | shared/prompts/review-prompt-divergence.test.ts | patch vs implement review prompt registry-body divergence > * branch-diff prose diverges | each implement review role body diverges from patch on unified-diff wording | per-role substring presence/absence pins (`not a unified diff`, `merge-base branch diff`) plus `not.toEqual(patchBody)` | incidental | re-key | | |
