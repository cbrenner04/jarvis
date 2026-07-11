# Plan preset builder and launcher registration

Add a `plan` workflow preset builder and register it on the launcher: `jarvis run workflow plan --ready-intent <path> [--target-dir <dir>]` validates the ready-intent, resolves identity, and builds one `write` step. Run-time write-step seeding/rendering is subspec 01.

## Verified prerequisites

- Generic `jarvis run workflow <name>` launcher resolves preset→builder and rejects unknown presets. Sources: `v2/src/cli.ts` `runWorkflowCommand`, `v2/src/execution/workflow-presets.ts` `WORKFLOW_PRESET_BUILDERS`, `v2/src/execution/workflow-runner.ts` `resolveWorkflowPreset`.
- `plan.prompt.draft` is registered. Source: `prompts/plan/draft.md`, manifest `prompts/registry.txt`.
- `buildIntentWorkflowSteps` is the builder pattern to mirror. Source: `v2/src/execution/intent-workflow-steps.ts`.

## Decisions

- Preset flag is `--ready-intent <path>`, not `--seed`; rule out reusing the intent parser — plan consumes an authored ready-intent, not a raw seed.
- Ready-intent validation ports v1's three checks (frontmatter `name:`, `name` matches filename, `## Prerequisites` section present) and the `ready-intents/` location check; rule out a looser gate — plan must reject un-authored inputs before drafting. Source: `v1/src/modes/plan/run.ts` `validateReadyIntent`.
- The builder reads the ready-intent content pre-daemon and threads it onto the write step as `intentSeed` (consumed by subspec 01); rule out the builder copying it into a spec dir — the builder runs pre-daemon, before the worktree/spec dir exists.
- The spec-dir UTC timestamp is generated once in the builder, pre-daemon (`new Date().toISOString()` normalization ported from v1 `formatPlanSpecTimestamp`), and threaded into the step so the path is stable across the run; rule out generating it inside the step — a per-iteration timestamp would drift the spec-dir path.
- Branch is `plan/<name>` (untimestamped); spec dir is `<targetDir>/<UTC-timestamp>-<name>/`; rule out timestamping the branch — matches v1 plan convention where only the spec path carries the timestamp.
- `--ready-intent` (input file) and `--target-dir` (draft output root) are orthogonal: the intent's `ready-intents/` parent does not derive the target dir. Rule out deriving target dir from the intent's parent — parity with v1.
- `--target-dir` precedence follows the intent builder: run override → project `plan.targetDir` → global `modes.plan.targetDir` → `spec`; the builder receives `configPath`. Rule out a plan-specific default.
- Preset pins `role: "plan"`, `promptId: "plan.prompt.draft"` via `WORKFLOW_PRESET_PINNED_FIELDS`; registers `plan` in `WORKFLOW_PRESET_BUILDERS` and `WORKFLOW_PRESET_LENGTHS` (length 1); rule out a caller-overridable role/prompt.
- `runWorkflowCommand` supplies `configPath` to the `plan` builder (extend the config-passing branch that today gates on `intent`/`intent-reviewed`); rule out omitting it as the implement preset does. Source: `v2/src/cli.ts` `isIntentPreset` branch.
- The write step sets `publishCompletion: true`; the completion artifact is the spec tree committed directly to `<spec-dir>/` (no staging/deferred landing). The interim completion contract is `index.md`-exists until subspec 02 hardens it.
- Deferred to first consumer: re-run semantics for an existing `plan/<name>` branch/worktree. Draft-only has no resume path.

## Scope

- Add `buildPlanWorkflowSteps(input)` returning `{ ok: true, steps, identity } | { ok: false, error }`, mirroring `buildIntentWorkflowSteps`; validate the ready-intent, generate the spec-dir timestamp, resolve target-dir precedence, and thread `intentSeed` + the timestamped `NAME` onto one `write` step.
- Add `parsePlanWorkflowArgs` (`--ready-intent`, `--target-dir`) and `WORKFLOW_PLAN_USAGE`; extend `runWorkflowCommand` to route the `plan` preset and pass it `configPath`.
- Register `plan` in `WORKFLOW_PRESET_BUILDERS`, `WORKFLOW_PRESET_LENGTHS`, `WORKFLOW_PRESET_PINNED_FIELDS`; extend `WORKFLOW_USAGE` to list `plan`.
- Do not wire write-step `intent.md` seeding, placeholder supply, or the `spec/<NAME>/` rewrite (subspec 01), nor the draft output contract/blocker gate (subspec 02).

## Acceptance criteria

- [x] `jarvis run workflow plan --ready-intent <path>` resolves the `plan` preset and builds exactly one `write` step with `role: "plan"` and `promptId: "plan.prompt.draft"`.
- [x] A ready-intent missing `name:` frontmatter, whose `name` mismatches the filename, lacking a `## Prerequisites` section, or not located in a `ready-intents/` directory is rejected pre-daemon with a non-zero exit and no step built.
- [x] The built step carries `intentSeed` (the ready-intent content verbatim), a timestamped `NAME` basename, branch `plan/<name>`, and a spec dir `<targetDir>/<UTC-timestamp>-<name>/`; the timestamp is generated once and stable across the built step.
- [x] `--ready-intent` and `--target-dir` are independent: identity routes to `--target-dir` (or its precedence chain) regardless of which `ready-intents/` tree the intent file lives in.
- [x] `--target-dir` overrides the target directory; absent it, precedence resolves project `plan.targetDir` → global `modes.plan.targetDir` → `spec` (builder receives `configPath`).
- [x] The built write step carries `publishCompletion: true`.
- [x] `WORKFLOW_USAGE` lists `plan`; an unknown preset name still exits `1` without contacting the daemon.
- [x] No registered project matching cwd yields a non-zero pre-daemon error naming the cwd.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- Update `v2/docs/workflow-runner.md` (§Authoring helper and presets) with the `plan` preset builder: one `plan` write step, `plan.prompt.draft`, `--ready-intent` input, timestamped spec dir, `plan/<name>` branch, target-dir precedence.
- Add a `[v2 additive]` entry to `v2/docs/v1-behaviors.md` for the `plan` preset citing `v2/src/cli.ts` and `v2/docs/workflow-runner.md`; do not rewrite v1 parity behavior.
