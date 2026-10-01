# Harness reliability ledger

Reviewed 2026-10-01 at `main` `31b71a376`. Companion to the [brief](./reliability-brief.md). Inventory: **0 active spec plans, 12 ready-intents, 17 seeds**; `completed/` excluded. Every queue artifact appears once below. “Plan” means the ready-intent's prerequisites are available, not that its implementation is approved or underway. “Intent” means a seed still needs decomposition and source-grounded planning. No runtime tests were rerun for this document review.

## Immediate reliability: ready-intents (10)

| Item | Next action / dependency | Remaining work and evidence |
| --- | --- | --- |
| [Resume inventory binding](./ready-intents/resume-path-inventory-binds-real-declaration.md) | Plan; shared helper landed #4345 | `parseResumePathInventoryAnchors` still uses first-match regex and a non-empty check. Bind the real declaration and assert its count. The regex already accepts `_`; do not plan a prefix-only fix. |
| [Structural-test docs](./ready-intents/self-parsing-structural-test-docs.md) | After resume inventory binding | Document the marker, fixture separation, prefix tolerance, and count proof. |
| [Write-loop test split](./ready-intents/write-loop-test-split.md) | Plan; recommend after inventory binding | #4340 is a load-sensitive classification workaround. Split with shared support and lossless inventory; at most 120 tests per file. Under-60-second measurements remain operator verification. #4350 is merged, removing the prior overlapping-PR hold. |
| [Record agent groups](./ready-intents/implement-run-records-agent-process-groups.md) | Plan; descendant reaping landed #4335 | Agent options expose probe/kill seams but no run-row recorder. Record the agent and snapshotted descendant groups through the existing recorder. |
| [Sweep recorded agent groups](./ready-intents/daemon-sweeps-recorded-agent-groups.md) | After recording | Prove existing dead-owner sweep reaches groups recorded by a real invocation path; avoid a fixture that only inserts an arbitrary group id and already passes before recording exists. No second sweep. |
| [Lane-PR run/stage settlement](./ready-intents/lane-pr-outcomes-settle-runs-and-stages.md) | Plan; history guard landed #4331 | Publisher and `loop_finished` carry `lanePrOutcome`; dedicated closed/merged settlement and retained PR evidence still need consumers. Preserve existing no-create behavior. |
| [Lane-PR daemon projections](./ready-intents/daemon-projects-lane-pr-settlement.md) | After lane-PR settlement | Project the same durable outcome and PR number in list/wait, stage observations, and notifications. |
| [Explicit resume republication](./ready-intents/resume-admits-lane-pr-republish-opt-in.md) | After lane-PR settlement; coordinate with projections | Thread one explicit resume opt-in through CLI, daemon, and publisher. Automatic recovery keeps the history guard. |
| [Plan-shape reprompt](./ready-intents/plan-draft-shape-contract-reprompt.md) | Plan; diagnostics/nested-child support landed #4332 | Current `isEligibleDraftContractReprompt` excludes the entire shape family, contrary to the intent's stale bare-equality premise. Allow one reprompt for repairable suffixes; keep missing-dir excluded. |
| [Plan-shape operator docs](./ready-intents/plan-draft-shape-operator-docs.md) | After shape reprompt | Align suffixes, accepted staging layouts, and recovery instructions with the completed behavior. |

## Immediate reliability: seeds (4)

| Item | Next action / dependency | Remaining work and evidence |
| --- | --- | --- |
| [Mutation killing-file fail-fast](./seeds/mutation-verifier-fails-fast-on-first-killing-file.md) | Intent; verify timeout race during planning | `runDiffDerivedScopedTests` awaits the full batch before checking failures. Abort/join remaining candidate work and release slots after a conclusive killing failure; preserve isolated-confirmation and timeout semantics. |
| [Resume verifies current mutations](./seeds/resume-mutation-repair-reverifies-before-repair.md) | Intent; coordinate with verifier work | `replayMutationFinalization` reconstructs the prior survivor and invokes auto-derived repair before current-HEAD verification. Repair only fresh verifier evidence; clean HEAD continues publication. |
| [Notification wait handoff](./seeds/notifications-wait-survives-daemon-handoff.md) | Intent | `waitForIncident` holds one client; `requestOrReport` rethrows connection loss. Reconnect with the delivery cursor and a bounded retry policy. Scope is `notifications wait`, not every wait command. |
| [Fan-out terminal settlement](./seeds/pipeline-fan-out-per-lane-terminal-settlement.md) | Intent; review merge coverage | `resolveTerminalPublicationInput` still refuses multi-branch publication. Lane ready-flips already exist; remaining scope is durable per-lane settlement, merge, failure attribution, and supersede behavior. Add explicit merge acceptance coverage; current criteria emphasize ready. |

## Follow-on workflow quality: seeds (5)

These continue the reliability direction but are outside the immediate completion target. Older evidence is retained as a planning input, not represented as newly reproduced failures.

| Item | Next action / dependency | Remaining scope |
| --- | --- | --- |
| [Target-repo documentation layout](./seeds/implement-respects-target-repo-doc-layout.md) | Intent; #3426 | Source still has Jarvis doc paths in the global documentation and intent-split prompts. Inject guidance and use the target's layout; the plan-draft script-name leak was already removed. |
| [Sibling-repo prerequisite coverage](./seeds/intent-split-covers-sibling-repo-surfaces.md) | Intent; #3439 | Check split-internal prerequisite coverage; do not introduce a repository registry based on the retired `siblings` premise. |
| [Detached ready-intent consumption](./seeds/detached-pipeline-plan-stage-consumes-ready-intents.md) | Intent; #3041 | Consume from the actual handoff source or record a reason. Silent path-resolution skips remain; external-home consumption and slug cleanup are already marked complete in the seed. |
| [Per-project configuration seam](./seeds/per-project-config-overrides-seam.md) | Intent; #3026 / #3150 | Resolve bounded agent-order and idle-timeout overrides once at admission; unchanged defaults and unknown-key validation. Structural continuation of dispatch parity, not an unfinished original retirement. |
| [Harness-run integration measurements](./seeds/implement-can-run-integration-slice-tests.md) | Intent | Provide observable harness execution for measurement criteria. Preserve the existing pass/fail suite rule; no requirement to build the parked general agent toolset first. |

## Operator features and ergonomics (3)

| Item | Stage / next action | Remaining scope |
| --- | --- | --- |
| [Pipeline review-feedback CLI](./ready-intents/pipeline-resume-address-review-cli.md) | Ready-intent: plan; daemon launch landed #4326 | Add `pipeline resume --address-review` parsing and IPC routing. The daemon handler and admission tests exist; the CLI flag does not. |
| [Serial chained fan-out](./seeds/pipeline-fan-out-lanes-serial-chained-bases.md) | Seed: after per-lane terminal settlement | New scheduling/base policy for dependent lanes, with explicit independence. Keep separate from fixing false terminal failure. |
| [TUI input clearing and feedback](./seeds/tui-typed-run-steering-clears-command-input.md) | Seed: intent | Clear successful run-steering input and expose thrown start errors. Source still returns directly after run steering; independent of the landed revision supervisor. |

## Parked design and cleanup: seeds (6)

| Item | Hold / dependency | Disposition |
| --- | --- | --- |
| [CLI retirement](./seeds/cli-retire-run-start-pause-and-config.md) | Decide whether `run pause` stays | Original charter side item. Reconcile retained pause consumers before removing commands; preserve agent-order editing and recovery coverage. |
| [CLI-aligned TUI grammar](./seeds/tui-dock-command-grammar-mirrors-cli.md) | Pause decision; selection/id and alias design | Prefer after input-feedback repair. Do not treat grammar redesign as required for structural recovery. |
| [Confinement policy](./seeds/agent-confinement-is-per-vendor-and-unexpressed.md) | Per-project override seam; policy design | Express vendor differences without changing defaults; single-operator legibility work. |
| [Fold shared runtime](./seeds/fold-shared-into-v2.md) | Low-priority repository migration | Broad import/test-scope move; schedule after runtime reliability changes settle. |
| [Retire v2 naming](./seeds/retire-v2-nomenclature.md) | After shared-runtime fold | Path, script, documentation, and config migration; unrelated to closing the old charter. |
| [Harness-owned agent tools](./seeds/harness-exposes-agent-toolset.md) | Explicit owner sign-off required | Large architectural proposal. Do not dispatch intent, plan, or pipeline; acceptance criteria are not defined. |

## Evidence-gated ready-intent (1)

| Item | Hold | Release condition |
| --- | --- | --- |
| [WAL lock-holder failure](./ready-intents/wal-lock-holder-child-survives-to-marker.md) | Do not plan or dispatch | An operator records a real rejection with exit code, signal, stderr tail, and source run in the intent. No cause is established; instrumentation landed #4097. |

## Review basis and upkeep

Immediate-queue checks used `completion-publisher.ts`, `write-loop.ts`, `workflow-runner-resume.ts`, `workflow-runner-resume-inventory.test.ts`, `diff-derived-mutation-verifier.ts`, `shared/invocation/agents.ts`, `shared/structural-test-locator.ts`, daemon pipeline/review-feedback handlers, and notification/pipeline CLI code. Prerequisite landings were checked in local `main` history. Older seeds were reviewed for scope and dependencies, with targeted prompt, consumption, config, and TUI source checks; their historical incidents were not re-run.

Counts reconcile to six ready-intents available for planning, five dependent ready-intents, and one evidence hold. No seed or intent is retired merely because a similarly named archive exists. On the next closeout, update rows and counts, move historical outcomes to the session report, and keep operating policy in the runbook/practices docs.
