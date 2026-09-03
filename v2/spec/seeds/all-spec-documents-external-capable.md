---
name: all-spec-documents-external-capable
---

# Every v2 spec-document kind is external-capable for opted-in projects

## Problem

v2's external spec home (`~/.jarvis/specs/<projectSafeId>/`) covers only two publication outputs — ready-intents and plan trees. Every other document kind or consumer is repo-bound, so a project that opts out of in-repo specs cannot ride v2 end to end: intent `--seed` input rejects absolute paths and escapes (`publication-workflow-steps.ts:181,186`), plan `--ready-intent` input rejects absolute paths (`:523`) so externally landed ready-intents cannot be consumed, cleanup archival hard-codes the in-repo home and rejects external identities (`cleanup.ts:743-749,827`), and there is no external `completed/`. Latent config inconsistency: intent's commit decision consults machine-level `modes.plan.commit` (`:291-292`); plan's does not (`:541`).

History (researched 2026-08-30): external-only was never the v2 default — the "No Jarvis artifacts in target repos" principle (#120) drove config and worktrees out of repos, never specs; the external home has been opt-in since #63/#64 (v1) and #1307/#1312 (v2), and only for the two outputs above.

## Prerequisites

- `match-git-disabled-chained-stage-workspaces` (#3119) — chained-stage dispatch resolves external workspaces.
- `implement-admits-externally-landed-specs` (#3122) — implement admits external plan trees. LANDED (#3272/#3297/#3350/#3360/#3363).

## Decisions

- Opt-in stays the contract (per project, the existing `plan.commit: false` / `git: false` keys); the in-repo default does not flip. Rules out relocating any existing project's specs.
- Intent `--seed` accepts a seed in the project's external home (`~/.jarvis/specs/<safeId>/seeds/`); consumption (deletion on landing) works there. Rules out repo-bound seeds being the only entry point.
- Plan `--ready-intent` accepts the external landing home (`~/.jarvis/specs/<safeId>/ready-intents/`), closing the #3119-workaround copy step. Rules out absolute-path rejection for the project's own managed home.
- Cleanup archives completed external specs to an external `completed/` sibling and its stranded-artifact scan covers registered projects' external homes; v1 external archival (#648) is the reference behavior. Rules out external specs never being archived.
- Plan's commit decision honors machine-level `modes.plan.commit` the way intent's does, or the intent row drops it — one rule, documented; drift between the two rows ends either way.
- Pipeline `pipeline-stage-resolve` accepts a prior stage's downstream input by filesystem existence when it resolves under the owning project's external home, the same predicate #3350 gave `resolveImplementStage`; the intent→plan hop stops validating external paths with `gitPathExistsOnBranch` (issue #3374). Rules out point-fixing one hop at a time.
- A fan-out lane whose stage settles `failed` while sibling lanes keep the pipeline non-terminal emits an operator incident carrying its `branchKey`; today such a lane is silent behind the next lane's gate (issue #3374, second defect). Rules out relying on pipeline-level terminal incidents alone.
- External homes remain per registered project via the shared `projectSafeId`. Rules out a global spec pool.

## Acceptance criteria

- [ ] An intent admission test proves `--seed` under the project's external seeds home admits, lands, and consumes for an opted-in project; it fails against the current relative-path/escape guards.
- [ ] A plan admission test proves `--ready-intent` naming a file in the project's external ready-intents home admits and drafts; it fails against the current absolute-path rejection.
- [ ] A cleanup test proves a completed external spec tree archives to the external `completed/` sibling and appears in stranded-artifact scans; it fails against the current in-repo-only discovery.
- [ ] A config test pins one shared commit-decision rule for intent and plan (machine-level fallback honored by both or by neither), failing against the current split.
- [ ] A pipeline stage-resolution test proves an intent stage's external ready-intent path resolves for the chained plan stage on a `plan.commit: false` project; it fails against the current `gitPathExistsOnBranch` guard.
- [ ] An operator-notification test proves a fan-out lane's `failed` stage on a still-live pipeline derives an incident naming its `branchKey`; it fails against the current pipeline-level-only derivation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md`, `v2/docs/operator-runbook.md` — the full external-home layout (`seeds/`, `ready-intents/`, `plans/`, `completed/`) and the opt-in keys, one authoritative table.
- `v2/docs/v1-behaviors.md` — parity with v1 external archival (#648) and any remaining divergence.
