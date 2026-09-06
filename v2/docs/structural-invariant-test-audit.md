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

Completeness is script output reconciliation: every `in-scope` file has ≥1 inventory row; every inventory row cites a file the script emitted `in-scope`. Re-run the script after discovery-rule changes and refresh the embedded manifest below. Downstream re-key work filters inventory rows with disposition `re-key`, grouped by `test-path` and `case-scope`.

## Candidate manifest

Verbatim stdout from `bun run scripts/discover-structural-invariant-tests.ts`:

```
test-path scope rule
shared/executable-tree.test.ts out-of-scope no-structural-signal
shared/git.test.ts out-of-scope no-structural-signal
shared/intent-stage.test.ts in-scope source-read
shared/invocation/agents.test.ts out-of-scope no-structural-signal
shared/invocation/claude-json.test.ts in-scope source-read
shared/invocation/cursor-json.test.ts out-of-scope no-structural-signal
shared/invocation/execute.test.ts out-of-scope no-structural-signal
shared/invocation/session-log.test.ts in-scope source-read
shared/is-record.test.ts out-of-scope no-structural-signal
shared/linked-subspec-routing.test.ts out-of-scope no-structural-signal
shared/module-boundary-surfaces.test.ts in-scope source-read
shared/mutation-checkpoint-criteria.test.ts out-of-scope no-structural-signal
shared/preload.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
shared/prices/cost.test.ts out-of-scope no-structural-signal
shared/prices/load.test.ts out-of-scope no-structural-signal
shared/project-safe-id.test.ts out-of-scope no-structural-signal
shared/prompts/assemble.test.ts out-of-scope no-structural-signal
shared/prompts/intent-split.test.ts out-of-scope no-structural-signal
shared/prompts/no-prompt-surgery-guard.test.ts in-scope source-read
shared/prompts/plan-draft.test.ts out-of-scope no-structural-signal
shared/prompts/registry.test.ts out-of-scope no-structural-signal
shared/prompts/render.test.ts out-of-scope no-structural-signal
shared/prompts/review-implement-contract-preservation.test.ts in-scope source-read
shared/prompts/review-implement-growth-budget.test.ts in-scope source-read
shared/prompts/review-implement.test.ts in-scope source-read
shared/prompts/review-plan-contract-preservation.test.ts out-of-scope no-structural-signal
shared/prompts/review-plan-growth-budget.test.ts in-scope source-read
shared/prompts/review-plan-hollow-pin.test.ts out-of-scope no-structural-signal
shared/prompts/review-plan-premise-falsification.test.ts out-of-scope no-structural-signal
shared/prompts/review-profile.test.ts out-of-scope no-structural-signal
shared/prompts/review-prompt-divergence.test.ts in-scope source-read
shared/prompts/step-rules.test.ts out-of-scope no-structural-signal
shared/publication-input-consumption.test.ts out-of-scope no-structural-signal
shared/shrink-step-id.test.ts out-of-scope no-structural-signal
shared/spec-parser.test.ts out-of-scope no-structural-signal
shared/subprocess.test.ts in-scope source-read
shared/worktree-lock.test.ts in-scope source-read
v2/src/cli.test.ts out-of-scope no-structural-signal
v2/src/cli/help-flags-parity.test.ts in-scope structural-name
v2/src/cli/stale-dispatch.test.ts out-of-scope no-structural-signal
v2/src/commands/cleanup-artifacts.test.ts in-scope source-read
v2/src/commands/cleanup-cli.test.ts out-of-scope no-structural-signal
v2/src/commands/cleanup.test.ts in-scope source-read
v2/src/commands/config.test.ts in-scope source-read
v2/src/commands/daemon.test.ts out-of-scope no-structural-signal
v2/src/commands/eligibility-gate.test.ts out-of-scope no-structural-signal
v2/src/commands/init.test.ts in-scope source-read
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
v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts in-scope source-read
v2/src/daemon/daemon-pipeline-approval.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-pipeline-dismiss.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-pipeline-handlers.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-pipeline-observation.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-pipeline-recover.test.ts in-scope source-read
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
v2/src/daemon/daemon-run-control-handler-guard.test.ts in-scope source-read
v2/src/daemon/daemon-run-dismiss.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-run-failure-capture.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-run-lifecycle-handlers.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-start-list.test.ts in-scope source-read
v2/src/daemon/daemon-state-store-lock-timeout.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-tail-stream.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-terminal-run-retention.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-test-inventory.test.ts in-scope source-read
v2/src/daemon/daemon-test-lifecycle.sandbox-unrunnable.test.ts in-scope source-read
v2/src/daemon/daemon-wait-run-completion.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-wire.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-workflow-admission-handlers.test.ts out-of-scope no-structural-signal
v2/src/daemon/daemon-workflow-start.test.ts in-scope source-read
v2/src/daemon/daemon.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/daemon/keyed-daemon-coexistence.sandbox-unrunnable.test.ts in-scope source-read
v2/src/daemon/live-daemon-socket-discovery.test.ts out-of-scope no-structural-signal
v2/src/daemon/memory-watermark.test.ts out-of-scope no-structural-signal
v2/src/daemon/operator-incidents.test.ts out-of-scope no-structural-signal
v2/src/daemon/operator-notification-sweep.test.ts out-of-scope no-structural-signal
v2/src/daemon/operator-notification.test.ts out-of-scope no-structural-signal
v2/src/daemon/pipeline-chained-workflow-deps.test.ts out-of-scope no-structural-signal
v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts in-scope source-read
v2/src/daemon/pipeline-execution.test.ts in-scope source-read
v2/src/daemon/pipeline-stage-dispatch.test.ts in-scope source-read
v2/src/daemon/pipeline-stage-recovery.test.ts in-scope source-read
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
v2/src/execution/implement-spec-landing.test.ts in-scope source-read
v2/src/execution/implement-workflow-steps.test.ts in-scope source-read
v2/src/execution/intent-output.test.ts in-scope source-read
v2/src/execution/intent-run-body-summary.test.ts out-of-scope no-structural-signal
v2/src/execution/intent-split-regression.test.ts in-scope source-read
v2/src/execution/intent-workflow-steps.test.ts out-of-scope no-structural-signal
v2/src/execution/pipeline-definition-validation.test.ts out-of-scope no-structural-signal
v2/src/execution/pipeline-posture-cli-alignment.test.ts out-of-scope no-structural-signal
v2/src/execution/pipeline-registry.test.ts out-of-scope no-structural-signal
v2/src/execution/plan-workflow-steps.test.ts in-scope source-read
v2/src/execution/pr-attribution.test.ts out-of-scope no-structural-signal
v2/src/execution/pr-body-refresh.test.ts out-of-scope no-structural-signal
v2/src/execution/project-pipeline-resolution.test.ts out-of-scope no-structural-signal
v2/src/execution/publication-landing.test.ts in-scope source-read
v2/src/execution/publication-retry.test.ts out-of-scope no-structural-signal
v2/src/execution/publication-spec-path.test.ts out-of-scope no-structural-signal
v2/src/execution/publication-workflow-steps.test.ts out-of-scope no-structural-signal
v2/src/execution/ready-finalize.test.ts in-scope source-read
v2/src/execution/review-cycle.test.ts in-scope source-read
v2/src/execution/review-debate.test.ts in-scope source-read
v2/src/execution/review-intent-enforcement.test.ts in-scope source-read
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
v2/src/execution/workflow-runner-debate-landing.test.ts in-scope source-read
v2/src/execution/workflow-runner-debate.test.ts in-scope source-read
v2/src/execution/workflow-runner-intent.test.ts in-scope source-read
v2/src/execution/workflow-runner-plan.test.ts in-scope source-read
v2/src/execution/workflow-runner-publication.test.ts in-scope source-read
v2/src/execution/workflow-runner-resume-inventory.test.ts in-scope source-read
v2/src/execution/workflow-runner-resume-structure.test.ts in-scope source-read
v2/src/execution/workflow-runner-resume.test.ts in-scope source-read
v2/src/execution/workflow-runner-review-standard.test.ts in-scope source-read
v2/src/execution/workflow-runner-review.test.ts in-scope source-read
v2/src/execution/workflow-runner-validation.test.ts in-scope source-read
v2/src/execution/workflow-runner.test.ts in-scope source-read
v2/src/execution/write-loop-dirty-completion.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop-idle-watchdog.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop-input.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop-intent-landing.test.ts in-scope source-read
v2/src/execution/write-loop-ready-gate-reap.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop-session-log.test.ts in-scope source-read
v2/src/execution/write-loop-staged-markdown-lint.test.ts in-scope source-read
v2/src/execution/write-loop-timeout.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/execution/write-loop.test.ts in-scope source-read
v2/src/execution/write-prompt.test.ts out-of-scope no-structural-signal
v2/src/execution/write.test.ts in-scope source-read
v2/src/export-surface-trim.test.ts out-of-scope no-structural-signal
v2/src/ipc/ipc.sandbox-unrunnable.test.ts out-of-scope no-structural-signal
v2/src/ipc/rpc-transport.test.ts out-of-scope no-structural-signal
v2/src/paths.test.ts in-scope source-read
v2/src/persistence/log-stream.test.ts in-scope source-read
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
| shr-rpd-patch-implement-divergence | shared/prompts/review-prompt-divergence.test.ts | patch vs implement review prompt registry-body divergence > * branch-diff prose diverges | each implement review role body diverges from patch on unified-diff wording | per-role substring presence/absence pins (`not a unified diff`, `merge-base branch diff`) plus `not.toEqual(patchBody)` | incidental | re-key | | yes |
| shr-is-stage-contract | shared/intent-stage.test.ts | intent stage contract > * | intent stage filename/content/structure validation and repair behave correctly | behavioral unit tests; `readFileSync` only on temp stage paths after repair | behavioral | n/a | | |
| shr-cj-parse-fixtures | shared/invocation/claude-json.test.ts | parseClaudeJsonOutput / isClaudeZeroExitQuotaEnvelope > * | Claude JSON envelope parsing and quota classification handle fixtures correctly | behavioral tests; `readFileSync` on `v1/test/fixtures/claude` JSON fixtures only | behavioral | n/a | | |
| shr-sl-writer | shared/invocation/session-log.test.ts | session log writer > * | session log writer creates namespaced files with stamped lines and close semantics | behavioral tests; `readFileSync` only on temp sessions dir paths | behavioral | n/a | | |
| shr-rigb-body-baselines | shared/prompts/review-implement-growth-budget.test.ts | implement review role growth budget > implement review role body growth stays within budget | implement review role prompt bodies stay under committed length ceilings | `IMPLEMENT_REVIEW_ROLE_BASELINES` and exported `*_BASELINE_BODY_LENGTH` literals vs `registry.getById(id).body.length` | incidental | re-key | | |
| shr-rigb-role-placeholders | shared/prompts/review-implement-growth-budget.test.ts | implement review role growth budget > implement review role placeholders unchanged | implement review role prompt frontmatter placeholders stay stable | `IMPLEMENT_REVIEW_ROLE_PLACEHOLDERS` literal map vs `readFileSync(artifact.sourcePath)` placeholders field parse | incidental | re-key | | |
| shr-rpgb-body-baselines | shared/prompts/review-plan-growth-budget.test.ts | plan review role growth budget > plan review role body growth stays within budget | plan review role prompt bodies stay under committed length ceilings | `PLAN_REVIEW_ROLE_BASELINES` and exported `*_BASELINE_BODY_LENGTH` literals vs `registry.getById(id).body.length` | incidental | re-key | | |
| shr-rpgb-role-placeholders | shared/prompts/review-plan-growth-budget.test.ts | plan review role growth budget > plan review role placeholders unchanged | plan review role prompt frontmatter placeholders stay stable | `PLAN_REVIEW_ROLE_PLACEHOLDERS` literal map vs `readFileSync(artifact.sourcePath)` placeholders field parse | incidental | re-key | | |
| shr-sp-runner | shared/subprocess.test.ts | realSubprocessRunner / realAsyncSubprocessRunner / predicate parity > * | subprocess runners, abort/group semantics, and git predicate parity behave correctly | behavioral integration; `readFileSync` only on temp `.scratch` pid files in group-mode fixtures | behavioral | n/a | | |
| shr-wtl-lock | shared/worktree-lock.test.ts | acquireLock / releaseLock / isProcessAlive > * | worktree lock acquire, busy/recovery paths, release, and pid liveness behave correctly | behavioral tests; `readFileSync` only on temp lock paths | behavioral | n/a | | |

## v2 daemon inventory

| row-id | test-path | case-scope | guarded-invariant | anchor-mechanism | classification | disposition | stay-incidental-rationale | vacuous-pass-risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dm-lifecycle-socket-filter | v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts | daemon-lifecycle > supersede > enumerateOtherDaemonSockets returns daemon-*.sock files excluding own socket | enumerateOtherDaemonSockets filters daemon-*.sock peers excluding own socket under jarvisHome | behavioral assertion on temp fixture tree; hardcoded exclusion files are harness setup, not production structure pins | behavioral | n/a | | |
| dm-pipeline-recover-plan-fixture | v2/src/daemon/daemon-pipeline-recover.test.ts | pipeline_recover admits and lands a corrected non-first fan-out branch without redrafting | corrected plan stage body lands to durable spec unchanged | `readFileSync` of `execution/fixtures/write-loop-staged-markdown-lint/plan-md012-clean-subspec.md` as golden body | incidental | re-key | | |
| dm-resume-intent-lint-fixture | v2/src/daemon/daemon-resume.test.ts | module scope (populated-stage intent finalization cases) | lint-clean intent stage markdown seeds landing/republication paths | module-level `readFileSync` of `execution/fixtures/write-loop-staged-markdown-lint/intent-md038-clean.md` golden | incidental | re-key | | |
| dm-rchg-forbidden-weakmap-symbols | v2/src/daemon/daemon-run-control-handler-guard.test.ts | daemon production sources omit activeRunsByHandler and activeRunForHandler | daemon production tree must not reintroduce handler WeakMap back-channel symbols | `FORBIDDEN_SYMBOLS` literal list scanned across all production `v2/src/daemon/**/*.ts` via `readFileSync` | incidental | re-key | | yes |
| dm-rchg-scanner-positive | v2/src/daemon/daemon-run-control-handler-guard.test.ts | guard reports reintroduced activeRun WeakMap back-channel symbols | scanner detects injected forbidden symbols | behavioral positive fixture on synthetic `daemon.ts` patch | behavioral | n/a | | |
| dm-startlist-terminal-settlement-guard | v2/src/daemon/daemon-start-list.test.ts | daemon production terminal writers are restricted to atomic settlement | daemon must not call legacy `commitGuardedKill`; only admitted `setRunStatus` transition is in-progress; reconciliation admission must not UPDATE status | regex/substring scans of concatenated production daemon sources plus `state-store.ts` slice | incidental | re-key | | yes |
| dm-test-inv-merge-base-titles | v2/src/daemon/daemon-test-inventory.test.ts | daemon test inventory > preserves merge-base test()/test.skip() titles per daemon test file | merge-base daemon test files must not drop existing test titles | `git merge-base`, `git ls-tree`, `git show`, worktree `readFileSync` title multiset diff per file | incidental | re-key | | |
| dm-test-inv-title-scanner | v2/src/daemon/daemon-test-inventory.test.ts | daemon test title scanner > * | title collector ignores nested/comments and test.each | behavioral unit tests of `collectTestTitles` parser | behavioral | n/a | | |
| dm-test-lifecycle-pid-capture | v2/src/daemon/daemon-test-lifecycle.sandbox-unrunnable.test.ts | runFixtureTest / fixture registers before failed readiness | nested test daemon pid is captured from pid file for teardown | `readFileSync(pidPath)` on temp pid file written by fixture | behavioral | n/a | | |
| dm-workflow-start-admission-seam | v2/src/daemon/daemon-workflow-start.test.ts | workflow starts, pipeline dispatch, and recovery share daemon admission | workflow start, pipeline dispatch, and recovery route through `admitWorkflowStart` without bypassing ownership/memory | production module `readFileSync` with `section()` slicing on const-declaration substring anchors | incidental | re-key | | |
| dm-keyed-coexistence-pid-files | v2/src/daemon/keyed-daemon-coexistence.sandbox-unrunnable.test.ts | daemon (keyed coexistence) > two daemons coexist with distinct digests over real sockets | each digest writes its pid to the expected pidPath | `readFileSync` of daemon pid files equals spawned pid | behavioral | n/a | | |
| dm-e2e-artifact-copy | v2/src/daemon/pipeline-end-to-end.sandbox-unrunnable.test.ts | pipeline end-to-end * | stage artifacts copied/read for chained handoff assertions | `readFileSync` of artifact-root spec paths in helpers | behavioral | n/a | | |
| dm-pipe-exec-worktree-assertions | v2/src/daemon/pipeline-execution.test.ts | pipeline chained plan and implement publication baseRef / plan stage ready-intent consumption | landed spec checkbox state and operator edit survival | `readFileSync` on worktree paths after pipeline execution | behavioral | n/a | | |
| dm-pipe-dispatch-ended-at-ast | v2/src/daemon/pipeline-stage-dispatch.test.ts | every terminal pipeline stage-run write carries endedAt | terminal `store.updateStage` status writes include `endedAt: Date.now()` | AST parse of production sources with hand-maintained `CLASSIFIED_STATUS_WRITES` identity registry | incidental | re-key | | |
| dm-pipe-recovery-plan-fixture | v2/src/daemon/pipeline-stage-recovery.test.ts | recoverPipelineBranchStage > * | recovery lands lint-clean plan subspec body | `readFileSync` of `plan-md012-clean-subspec.md` fixture as golden stage content | incidental | re-key | | |
| dm-pipe-prep-parity | v2/src/daemon/pipeline-workflow-preparation-parity.test.ts | pipeline workflow preparation parity > CLI and pipeline adapters produce byte-identical prepared steps | CLI `prepareWorkflowStart` and `preparePipelineStageWorkflow` emit identical steps | `JSON.stringify` parity compare on prepared steps | behavioral | n/a | | |
| dm-wlbinding-callers-allowlist | v2/src/daemon/write-loop-binding-source-guard.test.ts | only allowlisted modules call resolveWriteLoopBindings | `resolveWriteLoopBindings` caller surface is restricted | full `v2/src` production tree scan vs `ALLOWED_RESOLVE_WRITE_LOOP_BINDINGS_CALLERS` hardcoded list | incidental | re-key | | |
| dm-wlbinding-source-markers | v2/src/daemon/write-loop-binding-source-guard.test.ts | daemon binding resolution re-loads from the machine profile unless the snapshot replay test hook is set | daemon.ts retains binding-resolution source markers | substring presence pins on `daemon.ts` for `BINDING_SOURCE_MARKERS` literals | incidental | re-key | | yes |

## v2 execution-loop inventory

| row-id | test-path | case-scope | guarded-invariant | anchor-mechanism | classification | disposition | stay-incidental-rationale | vacuous-pass-risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ex-cc-real-git-commit | v2/src/execution/completion-commit.test.ts | createCompletionCommitter > formats changed files before staging so committed tree passes biome check | completion commit formats staged paths and lands biome-clean content on real git worktrees | `readFileSync`/`git show` on worktree paths after `copyFileSync` of committed `biome.json` from repo root | behavioral | n/a | | |
| ex-ddmv-observer-map-source | v2/src/execution/diff-derived-mutation-verifier.test.ts | module scope | verifier render-coverage seam tracks committed observer registry | `seamReadFile` default map validated via `extractRenderObserverMapFromSource`; custom maps built with `renderObserverMapSource` | behavioral | n/a | | |
| ex-ddmv-render-coverage-needle | v2/src/execution/diff-derived-mutation-verifier.test.ts | diff-derived-mutation-verifier > fails closed for registered prompts without render-observer map entries / invokes only that prompt's render-observer test file(s) | changed prompt bodies require registered render-observer killing tests | scoped `runScopedTests` invocation matched to `resolveRenderObserverTests(promptPath)` per changed prompt; synthetic body-line diffs without merge-base prose pins | behavioral | n/a | | |
| ex-ddmv-killing-resolution | v2/src/execution/diff-derived-mutation-verifier.test.ts | co-located killing-test resolution (sibling fallback) / direct-importing killing-test resolution | mutation verifier resolves co-located, sibling, and direct-importer killing tests before scoped execution | behavioral unit and integration tests of `resolveSiblingKillingTests`, importer scan caps, and scoped `runScopedTests` scheduling | behavioral | n/a | | |
| ex-ddmv-worktree-observer-map | v2/src/execution/diff-derived-mutation-verifier.test.ts | worktree render-observer map resolution > * | worktree-local observer map drives render-coverage without process-map fallback | `extractRenderObserverMapFromSource` on worktree `render-observer-tests.ts` plus git worktree fixture reads | behavioral | n/a | | |
| ex-ddmv-verifier-core | v2/src/execution/diff-derived-mutation-verifier.test.ts | diff-derived-mutation-verifier / TypeScript operator candidate classification / verification bounds | diff parsing, candidate classification, directive parsing, and bounded verification behave correctly | behavioral unit tests with synthetic diffs and seams (no production registry mirrors) | behavioral | n/a | | |
| ex-etsg-permitted-inventory | v2/src/execution/execution-terminal-settlement-guard.test.ts | execution production terminal writers are restricted to atomic settlement | terminal `commitTerminalRunSettlement`/`commitCompletionBoundary` and nonterminal `setRunStatus` sites match permitted inventory | scanned sites compared against exported `PERMITTED_TERMINAL_WRITES` and `PERMITTED_NONTERMINAL_SET_RUN_STATUS` from `execution-terminal-settlement-guard.ts` via `terminalSettlementInventoryMismatches` | behavioral | n/a | | |
| ex-etsg-scanner-positive | v2/src/execution/execution-terminal-settlement-guard.test.ts | guard rejects reintroduced terminal setRunStatus / inventory ignores line drift above tracked call sites | scanner flags injected terminal `setRunStatus` and ignores line drift for keyed inventory sites | behavioral positive/negative fixtures on synthetic production source patches | behavioral | n/a | | |
| ex-isl-worktree-landing | v2/src/execution/implement-spec-landing.test.ts | landImplementSpecTreeFromReadRoot > * | implement spec tree copies land expected paths and sidecars from `specReadRoot` | `readFileSync` on temp worktree paths after `landImplementSpecTreeFromReadRoot` | behavioral | n/a | | |
| ex-iws-build-implement | v2/src/execution/implement-workflow-steps.test.ts | buildImplementWorkflowSteps / resolveImplementSpecIdentity external plan admission | implement step builder resolves project, spec identity, review composition, and chained preflight | behavioral integration with mocked deps; worktree `readFileSync` only on fixture repos | behavioral | n/a | | |
| ex-io-intent-landing | v2/src/execution/intent-output.test.ts | landIntentWorkflowOutput > * | intent landing enforces rogue-path rules, handoff `specPath`, and `downstreamInputs` semantics | behavioral landing tests with temp-repo `readFileSync` assertions | behavioral | n/a | | |
| ex-isr-fixture-seeds | v2/src/execution/intent-split-regression.test.ts | module scope / intent split production write regression | split regression seeds are byte-stable fixture inputs | committed `INTENT_SPLIT_FIXTURES` ids loaded via `readIntentSplitFixture` / `locateDiscoveredFile`; `classifyRenderedSeed` compares rendered seed bytes to registry content | behavioral | n/a | | |
| ex-isr-primary-surfaces | v2/src/execution/intent-split-regression.test.ts | intent split production write regression > multi-surface seed fans out by surface through the production split write | staged intents name expected primary implementation surfaces | `seedPrimaryImplementationSurfaces` derives paths from `referencedArtifactPaths`, `classifyModuleBoundaryText`, and `orderModuleBoundariesForSplit` on fixture seed content | behavioral | n/a | | |
| ex-isr-split-oracles | v2/src/execution/intent-split-regression.test.ts | intent split production write regression > * | production split write honors surface-contract prompt pins | behavioral end-to-end `executeSeed` staging oracles via `assertMultiSurfaceStage` / `assertSingleSurfaceStage` | behavioral | n/a | | |
| ex-pws-spec-guidance-prose | v2/src/execution/plan-workflow-steps.test.ts | plan preset draft write step > `plan` invokes its binding through the production step-builder | plan draft prompt embeds committed spec-guidance prose | `capturedPrompt` whole-body containment of `readSpecGuidance()` output | behavioral | n/a | | |
| ex-pws-plan-routing | v2/src/execution/plan-workflow-steps.test.ts | plan ready-intent output routing / buildPlanWorkflowSteps review composition | plan workflows route ready-intents, external storage, and review steps correctly | behavioral builder tests (regex `specPath` routing, review step shape) | behavioral | n/a | | |
| ex-pl-tree-landing | v2/src/execution/publication-landing.test.ts | publication landing helpers > * | publication landing copies plan trees and intent artifacts into durable locations | `readFileSync` on worktree paths after landing helpers | behavioral | n/a | | |
| ex-rf-ready-gate | v2/src/execution/ready-finalize.test.ts | ready-finalize integration / base-ref probe / gate classification | ready gate scopes commands, classifies failures, and probes base-ref reproduction | behavioral tests with mocked git/subprocess seams (`merge-base` mocked, not structural inventory) | behavioral | n/a | | |
| ex-rc-review-cycle | v2/src/execution/review-cycle.test.ts | executeReviewCycle > * | review cycle hands verdicts to actuator, validates bounds, and persists verdict files | behavioral tests with temp verdict-path `readFileSync` | behavioral | n/a | | |
| ex-rd-review-debate | v2/src/execution/review-debate.test.ts | executeReviewDebate > * | debate cycle runs role order, quota handling, and verdict persistence | behavioral tests with temp verdict-path `readFileSync` | behavioral | n/a | | |
| ex-rie-verdict-ownership | v2/src/execution/review-intent-enforcement.test.ts | review-intent-enforcement > * | verdict ownership markers and working-tree snapshots gate enforced review cycles | behavioral tests of ownership checks and git inventory seams | behavioral | n/a | | |
| ex-wrc-workflow-core | v2/src/execution/workflow-runner-core.test.ts | workflow-runner core integration cases | core workflow runner lands artifacts and honors step contracts | behavioral integration with worktree `readFileSync` on landed outputs | behavioral | n/a | | |
| ex-wrdls-debate-absence | v2/src/execution/workflow-runner-debate-landing-structure.test.ts | review-debate landing helpers are not defined in workflow-runner.ts | extracted debate-landing helpers must not remain in `workflow-runner.ts` | exported `EXTRACTED_FROM_WORKFLOW_RUNNER` from `workflow-runner-debate-landing.ts` with paired absence/presence function-definition regex scans on production sources via `readProductionExecutionSource` | behavioral | n/a | | |
| ex-wrdl-debate-landing | v2/src/execution/workflow-runner-debate-landing.test.ts | workflow-runner debate landing integration | reviewed debate landing commits durable outputs | behavioral integration with worktree `readFileSync` | behavioral | n/a | | |
| ex-wrd-debate-flow | v2/src/execution/workflow-runner-debate.test.ts | workflow-runner debate integration cases | implement/plan debate review lands verdicts and durable spec edits | behavioral integration with worktree `readFileSync` | behavioral | n/a | | |
| ex-wri-intent-flow | v2/src/execution/workflow-runner-intent.test.ts | workflow-runner intent integration cases | intent workflow lands multi-file durable outputs and review edits | behavioral integration with worktree `readFileSync` | behavioral | n/a | | |
| ex-wrp-plan-flow | v2/src/execution/workflow-runner-plan.test.ts | workflow-runner plan integration / recoverPlanStage cases | plan workflow review and recovery land expected durable markdown | behavioral integration with worktree `readFileSync` | behavioral | n/a | | |
| ex-wrpub-publication-flow | v2/src/execution/workflow-runner-publication.test.ts | workflow-runner publication integration cases | publication workflow lands durable intents and checkbox state | behavioral integration with worktree `readFileSync` | behavioral | n/a | | |
| ex-wri-merge-base-titles | v2/src/execution/workflow-runner-resume-inventory.test.ts | workflow-runner resume test inventory > preserves merge-base resume-path leaf titles in workflow-runner-resume*.test.ts destinations | co-located resume test files preserve merge-base leaf-title multisets per source bucket | `SOURCE_BUCKETS` hand list plus `git merge-base`/`git show` title multiset parity against destination `readFileSync` | incidental | re-key | | |
| ex-wri-title-scanner | v2/src/execution/workflow-runner-resume-inventory.test.ts | resume test title scanner > * | title collector expands `test.each` and scopes to root describe | behavioral unit tests of `collectLeafTitles` parser | behavioral | n/a | | |
| ex-wrrs-resume-extraction | v2/src/execution/workflow-runner-resume-structure.test.ts | resume helpers are not defined in workflow-runner.ts / resume helpers are defined in workflow-runner-resume.ts | extracted resume helpers moved out of `workflow-runner.ts` into `workflow-runner-resume.ts` | exported `EXTRACTED_FROM_WORKFLOW_RUNNER` from `workflow-runner-resume.ts` with paired absence/presence function-definition regex scans on production sources via `readProductionExecutionSource` | behavioral | n/a | | |
| ex-wrr-resume-fixture-golden | v2/src/execution/workflow-runner-resume.test.ts | recoverPlanStage / resume mutation-repair cases using lint fixtures | recovery lands committed golden subspec bodies from staged-markdown-lint fixtures | committed `REVIEW_MD_LINT_FIXTURE_IDS` registry with `readReviewMdLintFixture` / `locateDiscoveredFile` loud-failure reads for recoverPlanStage and mutation-repair golden bodies | behavioral | n/a | | |
| ex-wrr-resume-integration | v2/src/execution/workflow-runner-resume.test.ts | workflow-runner resume integration (non-fixture cases) | resume paths settle publication, mutation repair, and staged markdown without silent regressions | behavioral integration with worktree `readFileSync` on landed stage/durable paths | behavioral | n/a | | |
| ex-wrrs-standard-review | v2/src/execution/workflow-runner-review-standard.test.ts | workflow-runner standard review integration | standard review landing preserves operator checkout dirt and durable outputs | behavioral integration with worktree `readFileSync` | behavioral | n/a | | |
| ex-wrr-review-fixture-golden | v2/src/execution/workflow-runner-review.test.ts | review staged-markdown-lint reprompt cases | review debate reprompt preserves golden violation/clean fixture bytes through recovery | committed `REVIEW_MD_LINT_FIXTURE_IDS` registry with `readReviewMdLintFixture` / `locateDiscoveredFile` loud-failure reads for review reprompt violation and clean golden bodies | behavioral | n/a | | |
| ex-wrr-review-integration | v2/src/execution/workflow-runner-review.test.ts | workflow-runner review integration (non-fixture cases) | review steps enforce verdict ownership and land reviewed outputs | behavioral integration with worktree `readFileSync` | behavioral | n/a | | |
| ex-wrv-validation | v2/src/execution/workflow-runner-validation.test.ts | workflow-runner validation integration | validation failures surface telemetry without leaking temp files | behavioral integration (`readFileSync` throws on cleaned telemetry path) | behavioral | n/a | | |
| ex-wr-implement-routing | v2/src/execution/workflow-runner.test.ts | executeWorkflow implement routing integration | implement workflow checks linked subspecs and external plan routing | behavioral integration with worktree `readFileSync` on spec checkboxes | behavioral | n/a | | |
| ex-wlil-intent-landing | v2/src/execution/write-loop-intent-landing.test.ts | write-loop intent landing integration | intent write-loop reprompts on staged markdown lint violations before finalize | behavioral integration with stage-path `readFileSync` | behavioral | n/a | | |
| ex-wlslog-session-records | v2/src/execution/write-loop-session-log.test.ts | write-loop session log emission | session logs record invocation lifecycle to jarvis sessions dir | behavioral tests reading emitted session log files under temp worktrees | behavioral | n/a | | |
| ex-wlsl-fixture-golden | v2/src/execution/write-loop-staged-markdown-lint.test.ts | plan/intent write step staged Markdown lint cases | staged markdown lint uses committed golden/violation fixture bodies | `readFileSync` of `fixtures/write-loop-staged-markdown-lint/*.md` golden bytes in reprompt/finalize paths | incidental | re-key | | |
| ex-wlsl-integration | v2/src/execution/write-loop-staged-markdown-lint.test.ts | write-loop staged markdown lint integration (non-fixture assertions) | write-loop reprompts and finalizes lint-clean staged plan/intent trees | behavioral `executeWriteLoop` integration with harness markdownlint binary probe | behavioral | n/a | | |
| ex-wl-write-loop | v2/src/execution/write-loop.test.ts | executeWriteLoop integration suite | write-loop iteration, ready gate, publication, mutation repair, and completion paths | behavioral integration; `readFileSync` only on worktree outputs and fixture paths | behavioral | n/a | | |
| ex-wr-spec-guidance-prose | v2/src/execution/write.test.ts | plan preset draft step isolates bundled human-only marker guidance | plan draft prompt embeds v2 spec-guidance agent-core prose without step-rule leakage | `extractSpecGuidance(capturedPrompt)` whole-body containment of `readSpecGuidance()` output plus forbidden-token absence checks; `@mutate` on `shared/spec-guidance-path.ts` | behavioral | n/a | | |
| ex-wr-execute-write | v2/src/execution/write.test.ts | executeWrite integration (non-spec-guidance cases) | write step lands plan/intent artifacts, enforces contracts, and preserves harness diagnostics | behavioral integration with worktree/stage `readFileSync` and module-boundary fixture reads | behavioral | n/a | | |

## v2 CLI and persistence inventory

| row-id | test-path | case-scope | guarded-invariant | anchor-mechanism | classification | disposition | stay-incidental-rationale | vacuous-pass-risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cli-hfp-guarded-paths | v2/src/cli/help-flags-parity.test.ts | help flag parser parity > every guarded path lists all parser-accepted flags | each CLI help path with parser surface lists every parser long flag | `commandTree` leaf paths with registered flags drive `parityGuardedPaths()` and `helpFlagsParityGaps()`; loud-failure on missing help nodes and on flagged leaves without a `parserAcceptedLongFlags` mapping | behavioral | n/a | | |
| cli-hfp-helper-positives | v2/src/cli/help-flags-parity.test.ts | help flag parser parity > delta cases (dropping/excluding flags, init/run kill alignment) | parity helper detects missing parser flags | behavioral unit tests of `missingParserFlagsInHelp` and `parserAcceptedLongFlags` | behavioral | n/a | | |
| cli-cleanup-artifacts | v2/src/commands/cleanup-artifacts.test.ts | completed v2 artifact archival > * | archival eligibility, transactional archive, and external-plan ready-intent skip | behavioral integration; `readFileSync` only on temp artifact paths | behavioral | n/a | | |
| cli-cleanup-e2e | v2/src/commands/cleanup.test.ts | cleanup: end-to-end via runCleanupCommand > * | merged worktree retirement, spec archival, daemon eligibility, and external-plan discovery | behavioral integration; `readFileSync` only on temp fixture paths | behavioral | n/a | | |
| cli-cleanup-abandon | v2/src/commands/cleanup.test.ts | cleanup: runAbandonCommand > * | abandon retirement order, PR closure, and refusal paths | behavioral integration with git/gh subprocess fixtures | behavioral | n/a | | |
| cli-cleanup-reset | v2/src/commands/cleanup.test.ts | resetStaleWorkspace / listDirtyWorktreePathsForStaleReset > * | stale workspace reset gates including harness sidecar, node_modules symlink, and landed-criteria refusal | behavioral integration and `@mutate`-coupled guard tests | behavioral | n/a | | |
| cli-cleanup-merged-refs | v2/src/commands/cleanup.test.ts | cleanup: discover merged branch-ref candidates > guard inversion * | merged-branch ref admission and prune guards | behavioral guard-inversion integration tests | behavioral | n/a | | |
| cli-config-command | v2/src/commands/config.test.ts | config command > * | set-agents persistence/validation and show/path subcommands | behavioral CLI tests with temp machine-config `readFileSync` | behavioral | n/a | | |
| cli-init-bootstrap | v2/src/commands/init.test.ts | init machine bootstrap > * | machine profile bootstrap idempotency, refusal paths, and guard inversions | behavioral integration with temp config `readFileSync` | behavioral | n/a | | |
| cli-init-profile-files | v2/src/commands/init.test.ts | init machine bootstrap > profile bindings govern bootstrap | committed machine profile filenames match `MACHINE_PROFILES_DIR` inventory | sorted `*.json` basenames from `machineProfileFilenames()` agree with dirent discovery; anti-vacuity pin vs pre-fix hand-maintained list | behavioral | n/a | | |
| cli-init-project | v2/src/commands/init.test.ts | init project registration > * | additive project registration and unsafe identity refusal | behavioral integration with temp config `readFileSync` | behavioral | n/a | | |
| cli-init-scaffold | v2/src/commands/init.test.ts | init planning directory > * | target-dir precedence, scaffold containment, and queue sentinels | behavioral integration with project-tree `readFileSync`/`listFiles` | behavioral | n/a | | |
| cli-init-readiness | v2/src/commands/init.test.ts | init readiness / init read-only check > * | readiness report ordering, requiredness, probe normalization, and `--check` non-mutation | behavioral tests of `evaluateReadiness`/`renderReadinessReport` and check-mode integration | behavioral | n/a | | |
| cli-wsp-posture-tables | v2/src/commands/workflow-start-preparation.test.ts | workflow-start preparation authority > realizes every supported workflow and review posture | base workflow names and review postures match exported registries | exported registry tables and resolver properties drive coverage; anti-vacuity pin vs pre-fix hardcoded literal arrays | behavioral | n/a | | |
| cli-wsp-single-owner | v2/src/commands/workflow-start-preparation.test.ts | workflow-start preparation authority > production realizability and posture-to-preset tables live only in the shared owner | realizability tables and forbidden declaration patterns stay in owner module | production tree scan pairs forbidden-declaration absence outside owner with owner symbol slicing via `locateSymbolSlice`; `locateDiscoveredFile` routes source reads | behavioral | n/a | | |
| cli-wsp-prepare-calls | v2/src/commands/workflow-start-preparation.test.ts | workflow-start preparation authority > production prepared-step assembly lives only in shared preparation and the pipeline adapter | `prepareWorkflowStart` and resolver assembly stay on allowlisted modules | production-tree discovery must equal fixed allowlist `{owner, pipeline adapter, CLI adapter}`; `symbolResolvedMoveGuard` pairs absence outside that set with owner presence; anti-vacuity pin vs pre-fix `PREPARE_CALL_ALLOWED_PATHS` | behavioral | n/a | | |
| cli-wf-dispatch | v2/src/commands/workflow.test.ts | run workflow dispatch / ticked implement recovery / workflow detach / review-passes / implement validation / stale workspace reset (non-structural cases) | workflow CLI dispatch, recovery, detach, review stamping, and stale-reset integration | behavioral CLI integration; `readFileSync` only on temp spec/worktree paths | behavioral | n/a | | |
| cli-wf-prep-call-count | v2/src/commands/workflow.test.ts | shared workflow-start preparation > run workflow intent plan and implement preserve prepared start steps | `workflow.ts` calls `prepareWorkflowStart` exactly once | `locateSymbolSlice` on `runWorkflowCommand` body resolves single prepare-call site | behavioral | n/a | | |
| cli-wf-prep-delegation | v2/src/commands/workflow.test.ts | shared workflow-start preparation > runWorkflowCommand delegates build stamp and stale-reset preparation to the shared owner | workflow command delegates stamp/stale-reset to shared owner without local duplicates | command-body absence paired with owner `prepareWorkflowStart` slice presence via `locateSymbolSlice` | behavioral | n/a | | |
| cli-wf-stale-reset-workflows | v2/src/commands/workflow.test.ts | implement preflight stale workspace reset > STALE_RESET_WORKFLOWS membership includes intent | intent workflow is in stale-reset set | exported `STALE_RESET_WORKFLOWS.has("intent")` membership plus roster properties; anti-vacuity pin vs pre-fix hardcoded Set equality | behavioral | n/a | | |
| cli-paths-constants | v2/src/paths.test.ts | paths / jarvis home isolation (suite isolation cases) | jarvis-home path constants and isolated-home preload | behavioral unit tests of path exports and `JARVIS_HOME` isolation | behavioral | n/a | | |
| cli-paths-homedir-guard | v2/src/paths.test.ts | jarvis home isolation > no v2 source resolves a jarvis-home path via homedir() directly | production tree must not call `homedir()` outside `paths.ts` | production tree discovery pairs homedir absence outside `paths.ts` with canonical presence via `locateDiscoveredFile` and `pairedHomedirGuard`; anti-vacuity vs pre-fix absence-only scan | behavioral | n/a | | |
| cli-log-stream | v2/src/persistence/log-stream.test.ts | log-stream > * | sink/reader persistence, tail/follow ordering, and event round-trip | behavioral unit/integration tests; `readFileSync` only on temp storage paths | behavioral | n/a | | |
| cli-timer-guard-predicate | v2/src/testing/timer-callback-guard-fixture.test.ts | shouldStopPolling: draining poller stops only once no work is pending | polling stops only when draining idle or stop requested | behavioral truth-table test of exported `shouldStopPolling` predicate | behavioral | n/a | | |

## Downstream re-key queue

Every inventory row with disposition `re-key`, grouped by `test-path` + `case-scope`. Counts are re-key rows per group.

### shared/module-boundary-surfaces.test.ts

**case-scope:** module boundary surfaces > classifies committed phrases

**re-key (1):** shr-mbs-surfaces-registry

### shared/module-boundary-surfaces.test.ts

**case-scope:** module boundary surfaces > inverting draft dependency order guard fails k4

**re-key (1):** shr-mbs-k4-cli-first-filename

### shared/module-boundary-surfaces.test.ts

**case-scope:** module boundary surfaces > normalizes the * staged tree without provenance

**re-key (4):** shr-mbs-split-emitted-files, shr-mbs-split-index-links, shr-mbs-split-section-bullets, shr-mbs-manifest-union

### shared/prompts/no-prompt-surgery-guard.test.ts

**case-scope:** prompt assembly builders omit post-render string surgery

**re-key (2):** shr-npsg-assembly-paths, shr-npsg-forbidden-tokens

### shared/prompts/review-implement-contract-preservation.test.ts

**case-scope:** implement review role contract preservation > implement review role contract substrings preserved

**re-key (1):** shr-ricp-contract-markers

### shared/prompts/review-implement-growth-budget.test.ts

**case-scope:** implement review role growth budget > implement review role body growth stays within budget

**re-key (1):** shr-rigb-body-baselines

### shared/prompts/review-implement-growth-budget.test.ts

**case-scope:** implement review role growth budget > implement review role placeholders unchanged

**re-key (1):** shr-rigb-role-placeholders

### shared/prompts/review-implement.test.ts

**case-scope:** renderPatchReviewCriticPrompt branch diff > renders stat, changed paths, and merge-base unified diff for critic and debate roles

**re-key (1):** shr-ri-merge-base-prose

### shared/prompts/review-plan-growth-budget.test.ts

**case-scope:** plan review role growth budget > plan review role body growth stays within budget

**re-key (1):** shr-rpgb-body-baselines

### shared/prompts/review-plan-growth-budget.test.ts

**case-scope:** plan review role growth budget > plan review role placeholders unchanged

**re-key (1):** shr-rpgb-role-placeholders

### shared/prompts/review-prompt-divergence.test.ts

**case-scope:** patch vs implement review prompt registry-body divergence > * branch-diff prose diverges

**re-key (1):** shr-rpd-patch-implement-divergence

### v2/src/daemon/daemon-pipeline-recover.test.ts

**case-scope:** pipeline_recover admits and lands a corrected non-first fan-out branch without redrafting

**re-key (1):** dm-pipeline-recover-plan-fixture

### v2/src/daemon/daemon-resume.test.ts

**case-scope:** module scope (populated-stage intent finalization cases)

**re-key (1):** dm-resume-intent-lint-fixture

### v2/src/daemon/daemon-run-control-handler-guard.test.ts

**case-scope:** daemon production sources omit activeRunsByHandler and activeRunForHandler

**re-key (1):** dm-rchg-forbidden-weakmap-symbols

### v2/src/daemon/daemon-start-list.test.ts

**case-scope:** daemon production terminal writers are restricted to atomic settlement

**re-key (1):** dm-startlist-terminal-settlement-guard

### v2/src/daemon/daemon-test-inventory.test.ts

**case-scope:** daemon test inventory > preserves merge-base test()/test.skip() titles per daemon test file

**re-key (1):** dm-test-inv-merge-base-titles

### v2/src/daemon/daemon-workflow-start.test.ts

**case-scope:** workflow starts, pipeline dispatch, and recovery share daemon admission

**re-key (1):** dm-workflow-start-admission-seam

### v2/src/daemon/pipeline-stage-dispatch.test.ts

**case-scope:** every terminal pipeline stage-run write carries endedAt

**re-key (1):** dm-pipe-dispatch-ended-at-ast

### v2/src/daemon/pipeline-stage-recovery.test.ts

**case-scope:** recoverPipelineBranchStage > *

**re-key (1):** dm-pipe-recovery-plan-fixture

### v2/src/daemon/write-loop-binding-source-guard.test.ts

**case-scope:** daemon binding resolution re-loads from the machine profile unless the snapshot replay test hook is set

**re-key (1):** dm-wlbinding-source-markers

### v2/src/daemon/write-loop-binding-source-guard.test.ts

**case-scope:** only allowlisted modules call resolveWriteLoopBindings

**re-key (1):** dm-wlbinding-callers-allowlist

### v2/src/execution/workflow-runner-resume-inventory.test.ts

**case-scope:** workflow-runner resume test inventory > preserves merge-base resume-path leaf titles in workflow-runner-resume*.test.ts destinations

**re-key (1):** ex-wri-merge-base-titles

### v2/src/execution/workflow-runner-resume-structure.test.ts

**case-scope:** resume helpers are not defined in workflow-runner.ts / resume helpers are defined in workflow-runner-resume.ts

**re-key (1):** ex-wrrs-resume-extraction

### v2/src/execution/write-loop-staged-markdown-lint.test.ts

**case-scope:** plan/intent write step staged Markdown lint cases

**re-key (1):** ex-wlsl-fixture-golden
