# Shared step-config stamp

## Problem

`prepareWorkflowSteps` (`v2/src/commands/workflow.ts:248–266`) is the only production site that stamps machine-config values onto workflow write/review steps. The mapping core must become one exported function both the CLI and daemon dispatch paths call; rules out a daemon-local duplicate that can drift.

## Decision ledger

- Export one function from the command/workflow layer — built `AnyWorkflowStep[]` plus machine-config path → stamped steps — and have `prepareWorkflowSteps` build then stamp through it only; rules out leaving the `built.steps.map` mapping inline in `prepareWorkflowSteps`.
- Preserve today's unstamped-vs-default semantics: omit `fixCommand`/`readyCommand`/`idleOutputMs` on write steps when unconfigured, always stamp resolved write-path bounds and `roleTimeoutMs` on review steps; rules out forcing explicit defaults onto steps that today omit optional fields.
- Machine-config read failures still fail CLI admission through `prepareWorkflowSteps` with stderr from the existing catch; rules out swallowing loader errors on the shared export (daemon callers handle errors at their seam in subspec 01).

## Task checklist

- Extract the `built.steps.map` stamping block from `prepareWorkflowSteps` into an exported function in the command/workflow layer (new module or `workflow.ts` export).
- Refactor `prepareWorkflowSteps` to call the export after a successful preset build; no other call sites yet.
- Add a structural regression test in `workflow.test.ts` that fails when the step-mapping logic is re-inlined into `prepareWorkflowSteps`.
- Run `bun run typecheck` and `bun run test:v2` scoped to touched surfaces.

## Acceptance criteria

- [ ] `prepareWorkflowSteps` stamps steps only through the shared export — a structural test in `v2/src/commands/workflow.test.ts` fails when the `readProjectFixCommand` / `readProjectReadyCommand` / bounds / review-timeout mapping is re-inlined into `prepareWorkflowSteps` instead of delegating to the export.
- [ ] `v2/src/commands/workflow.test.ts` — `readyCommand admission` describe stays green.
- [ ] `v2/src/commands/workflow.test.ts` — review idle-budget and `reviewRoleTimeoutMs` admission tests stay green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — behavior-preserving extraction; operator-facing docs land in subspec 01.
