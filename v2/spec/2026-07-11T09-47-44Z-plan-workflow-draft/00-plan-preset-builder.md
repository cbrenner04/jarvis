# Plan preset builder and launcher registration

Add a `plan` workflow preset: `jarvis run workflow plan --ready-intent <path> [--target-dir <dir>]` builds one `write` step that drafts a spec tree from a ready-intent and publishes on completion.

## Verified prerequisites

- Generic `jarvis run workflow <name>` launcher resolves preset→builder and rejects unknown presets. Sources: `v2/src/cli.ts` `runWorkflowCommand`, `v2/src/execution/workflow-presets.ts` `WORKFLOW_PRESET_BUILDERS`, `v2/src/execution/workflow-runner.ts` `resolveWorkflowPreset`.
- `write` step with completion publish (commit + draft PR) exists. Sources: `v2/src/execution/write.ts`, `v2/src/execution/completion-commit.ts`, `v2/src/execution/completion-publisher.ts` wired in `workflow-runner.ts`.
- `plan.prompt.draft` is registered. Source: `prompts/plan/draft.md`, manifest `prompts/registry.txt`.

## Decisions

- Preset flag is `--ready-intent <path>`, not `--seed`; rule out reusing the intent parser — plan consumes an authored ready-intent, not a raw seed.
- Ready-intent validation ports v1's three checks (frontmatter `name:`, `name` matches filename, `## Prerequisites` section present) and the `ready-intents/` location check; rule out a looser gate — plan must reject un-authored inputs before drafting. Source: `v1/src/modes/plan/run.ts` `validateReadyIntent`.
- Builder copies the ready-intent verbatim into the spec dir as `intent.md` (frontmatter preserved) before the agent runs; rule out passing content only through prompt placeholders — the durable `intent.md` is the blocker/audit target the draft contract inspects.
- Branch is `plan/<name>` (untimestamped); spec dir is `<targetDir>/<UTC-timestamp>-<name>/`; rule out timestamping the branch — matches v1 plan convention where only the spec path carries the timestamp.
- Preset pins `role: "plan"`, `promptId: "plan.prompt.draft"` via `WORKFLOW_PRESET_PINNED_FIELDS`; registers `plan` in `WORKFLOW_PRESET_BUILDERS` and `WORKFLOW_PRESET_LENGTHS` (length 1); rule out a caller-overridable role/prompt — the preset owns them.
- The write step sets `publishCompletion: true` and `expectedArtifactPath` to `index.md`; rule out the intent preset's `.jarvis-intent-stage` staging path — plan commits its spec tree directly, no deferred landing.
- `--target-dir` precedence follows the intent builder: run override → project `plan.targetDir` → global `modes.plan.targetDir` → `spec`; rule out a plan-specific default — parity with existing plan/intent routing.

## Scope

- Add `buildPlanWorkflowSteps(input)` returning `{ ok: true, steps, identity } | { ok: false, error }`, mirroring `buildIntentWorkflowSteps`.
- Add `parsePlanWorkflowArgs` (`--ready-intent`, `--target-dir`) and `WORKFLOW_PLAN_USAGE`; extend `runWorkflowCommand` to route the `plan` preset.
- Register `plan` in `WORKFLOW_PRESET_BUILDERS`, `WORKFLOW_PRESET_LENGTHS`, `WORKFLOW_PRESET_PINNED_FIELDS`; extend `WORKFLOW_USAGE` to list `plan`.
- Do not change the draft output contract or the prerequisite blocker gate (subspec 01 owns them); the write step lands on the basic `index.md`-exists contract until then.

## Acceptance criteria

- [ ] `jarvis run workflow plan --ready-intent <path>` resolves the `plan` preset and builds exactly one `write` step with `role: "plan"` and `promptId: "plan.prompt.draft"`.
- [ ] A ready-intent missing `name:` frontmatter, whose `name` mismatches the filename, lacking a `## Prerequisites` section, or not located in a `ready-intents/` directory is rejected pre-daemon with a non-zero exit and no step built.
- [ ] A successful build copies the ready-intent verbatim to `<spec-dir>/intent.md` with frontmatter preserved, on branch `plan/<name>`, under a spec dir `<targetDir>/<UTC-timestamp>-<name>/`.
- [ ] `--target-dir` overrides the spec dir target directory; absent it, precedence resolves project `plan.targetDir` → global `modes.plan.targetDir` → `spec`.
- [ ] The built write step carries `publishCompletion: true`, so a passing run commits and opens a draft PR via the existing completion publisher.
- [ ] `WORKFLOW_USAGE` lists `plan`; an unknown preset name still exits `1` without contacting the daemon.
- [ ] No registered project matching cwd yields a non-zero pre-daemon error naming the cwd.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- Update `v2/docs/workflow-runner.md` (§Authoring helper and presets) with the `plan` preset: one `plan` write step, `plan.prompt.draft`, `--ready-intent` input, timestamped spec dir, `plan/<name>` branch.
- Update `v2/docs/write-behavior.md` registered-preset list and workflow usage with `plan`.
- Add a `[v2 additive]` entry to `v2/docs/v1-behaviors.md` for the `plan` preset citing `v2/src/cli.ts` and `v2/docs/workflow-runner.md`; do not rewrite v1 parity behavior.
