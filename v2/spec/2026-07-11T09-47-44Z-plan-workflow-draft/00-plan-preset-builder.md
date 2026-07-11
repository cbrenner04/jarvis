# Plan preset builder and launcher registration

Add a `plan` workflow preset: `jarvis run workflow plan --ready-intent <path> [--target-dir <dir>]` builds one `write` step that drafts a spec tree from a ready-intent and publishes on completion.

## Verified prerequisites

- Generic `jarvis run workflow <name>` launcher resolves preset→builder and rejects unknown presets. Sources: `v2/src/cli.ts` `runWorkflowCommand`, `v2/src/execution/workflow-presets.ts` `WORKFLOW_PRESET_BUILDERS`, `v2/src/execution/workflow-runner.ts` `resolveWorkflowPreset`.
- `write` step with completion publish (commit + draft PR) exists. Sources: `v2/src/execution/write.ts`, `v2/src/execution/completion-commit.ts`, `v2/src/execution/completion-publisher.ts` wired in `workflow-runner.ts`.
- `plan.prompt.draft` is registered. Source: `prompts/plan/draft.md`, manifest `prompts/registry.txt`.

## Decisions

- Preset flag is `--ready-intent <path>`, not `--seed`; rule out reusing the intent parser — plan consumes an authored ready-intent, not a raw seed.
- Ready-intent validation ports v1's three checks (frontmatter `name:`, `name` matches filename, `## Prerequisites` section present) and the `ready-intents/` location check; rule out a looser gate — plan must reject un-authored inputs before drafting. Source: `v1/src/modes/plan/run.ts` `validateReadyIntent`.
- `intent.md` is seeded into the worktree by the **write step at run time**, not by the builder; the builder reads the ready-intent content pre-daemon and threads it as a write-step input (`intentSeed`), and the step writes `<spec-dir>/intent.md` after the worktree exists (`withExternalWorktree`) and before invoking the agent. Rule out "the builder copies it into the spec dir" — the builder runs pre-daemon, before the worktree/spec dir exists, so it cannot; rule out passing content only through the `INTENT` placeholder — the durable on-disk `intent.md` is the blocker/audit target subspec 01 inspects.
- The write step supplies all four required `plan.prompt.draft` placeholders: `WORKDIR` = worktree root, `NAME` = the timestamped spec-dir basename, `INTENT` = the ready-intent content, `SPEC_GUIDANCE` = the bundled spec-guidance doc content (the same guidance v1 injects, read from the jarvis-bundled doc). Rule out relying on the agent to read guidance itself (as the intent-split prompt does) — `plan.prompt.draft` declares `SPEC_GUIDANCE` required, so a missing placeholder fails the render.
- The step reconciles the prompt's literal `spec/<NAME>/` output path with the timestamped spec dir by porting v1's rewrite: replace `spec/<NAME>/` with `<targetDir>/<NAME>/` and set `NAME` to the timestamped basename, so the agent writes to and the contract inspects the same `<targetDir>/<UTC-timestamp>-<name>/`. Source: `v1/src/modes/plan/draft.ts` `buildDraftPrompt`. Rule out leaving the literal `spec/<NAME>/` — the agent would write one path and the contract inspect another.
- The spec-dir UTC timestamp is generated once in the builder, pre-daemon (ordinary `new Date().toISOString()` normalization ported from v1 `formatPlanSpecTimestamp`), and threaded into the step so the path is stable across the run; rule out generating it inside the step — a per-iteration timestamp would drift the spec-dir path.
- Branch is `plan/<name>` (untimestamped); spec dir is `<targetDir>/<UTC-timestamp>-<name>/`; rule out timestamping the branch — matches v1 plan convention where only the spec path carries the timestamp.
- `--ready-intent` (input file) and `--target-dir` (draft output root) are orthogonal: the intent's `ready-intents/` parent does not derive the target dir. Rule out deriving target dir from the intent's parent — parity with v1 where input location and output root are separate.
- Preset pins `role: "plan"`, `promptId: "plan.prompt.draft"` via `WORKFLOW_PRESET_PINNED_FIELDS`; registers `plan` in `WORKFLOW_PRESET_BUILDERS` and `WORKFLOW_PRESET_LENGTHS` (length 1); rule out a caller-overridable role/prompt — the preset owns them.
- `runWorkflowCommand` supplies `configPath` to the `plan` builder (extend the config-passing branch that today gates on `intent`/`intent-reviewed`); rule out omitting it as the implement preset does — plan needs `configPath` for its own target-dir precedence resolution. Source: `v2/src/cli.ts` `isIntentPreset` branch.
- The write step sets `publishCompletion: true`; the completion artifact is the spec tree committed directly to `<spec-dir>/` (no `.jarvis-intent-stage` staging, no deferred landing). Subspec 00's interim contract is `index.md`-exists (superseded by subspec 01).
- `--target-dir` precedence follows the intent builder: run override → project `plan.targetDir` → global `modes.plan.targetDir` → `spec`; rule out a plan-specific default — parity with existing plan/intent routing.
- Deferred to first consumer: re-run semantics for an existing `plan/<name>` branch/worktree (error, resume, or reuse) — pin when a caller needs it. Draft-only has no resume path.

## Scope

- Add `buildPlanWorkflowSteps(input)` returning `{ ok: true, steps, identity } | { ok: false, error }`, mirroring `buildIntentWorkflowSteps`; generate the spec-dir timestamp here and thread `intentSeed`, `NAME`, and the placeholder set into the step.
- Add `parsePlanWorkflowArgs` (`--ready-intent`, `--target-dir`) and `WORKFLOW_PLAN_USAGE`; extend `runWorkflowCommand` to route the `plan` preset and pass it `configPath`.
- Extend the write step so it seeds `<spec-dir>/intent.md` from `intentSeed` inside the worktree before invoking the agent, and supplies the `WORKDIR`/`NAME`/`INTENT`/`SPEC_GUIDANCE` placeholders with the `spec/<NAME>/`→`<targetDir>/<NAME>/` rewrite applied.
- Register `plan` in `WORKFLOW_PRESET_BUILDERS`, `WORKFLOW_PRESET_LENGTHS`, `WORKFLOW_PRESET_PINNED_FIELDS`; extend `WORKFLOW_USAGE` to list `plan`.
- Do not change the draft output contract or the prerequisite blocker gate (subspec 01 owns them); the write step lands on the basic `index.md`-exists contract until then.

## Acceptance criteria

- [ ] `jarvis run workflow plan --ready-intent <path>` resolves the `plan` preset and builds exactly one `write` step with `role: "plan"` and `promptId: "plan.prompt.draft"`.
- [ ] A ready-intent missing `name:` frontmatter, whose `name` mismatches the filename, lacking a `## Prerequisites` section, or not located in a `ready-intents/` directory is rejected pre-daemon with a non-zero exit and no step built.
- [ ] A successful run seeds the ready-intent verbatim to `<spec-dir>/intent.md` (frontmatter preserved) inside the worktree before the agent runs, on branch `plan/<name>`, under a spec dir `<targetDir>/<UTC-timestamp>-<name>/`; the timestamp is generated once and stable across the run.
- [ ] The built write step renders `plan.prompt.draft` with all four required placeholders (`WORKDIR`, `NAME`, `INTENT`, `SPEC_GUIDANCE`) satisfied, and the `spec/<NAME>/` output path is rewritten so the agent writes into `<targetDir>/<UTC-timestamp>-<name>/`.
- [ ] `--ready-intent` and `--target-dir` are independent: the draft routes to `--target-dir` (or its precedence chain) regardless of which `ready-intents/` tree the intent file lives in.
- [ ] `--target-dir` overrides the spec dir target directory; absent it, precedence resolves project `plan.targetDir` → global `modes.plan.targetDir` → `spec` (builder receives `configPath`).
- [ ] The built write step carries `publishCompletion: true`, so a passing run commits and opens a draft PR via the existing completion publisher.
- [ ] `WORKFLOW_USAGE` lists `plan`; an unknown preset name still exits `1` without contacting the daemon.
- [ ] No registered project matching cwd yields a non-zero pre-daemon error naming the cwd.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- Update `v2/docs/workflow-runner.md` (§Authoring helper and presets) with the `plan` preset: one `plan` write step, `plan.prompt.draft`, `--ready-intent` input, timestamped spec dir, `plan/<name>` branch.
- Update `v2/docs/write-behavior.md` registered-preset list and workflow usage with `plan`, including the run-time `intent.md` seeding step and the `WORKDIR`/`NAME`/`INTENT`/`SPEC_GUIDANCE` placeholder supply with the `spec/<NAME>/` rewrite.
- Add a `[v2 additive]` entry to `v2/docs/v1-behaviors.md` for the `plan` preset citing `v2/src/cli.ts` and `v2/docs/workflow-runner.md`; do not rewrite v1 parity behavior.
