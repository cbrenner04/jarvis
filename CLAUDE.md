# AGENTS.md

Decisions and conventions for working in this repo. This file is for humans and coding agents alike.

## What this repo is

`jarvis` is a minimal coding-agent harness ("ralph loop"). It sends one-shot prompts to an underlying agent CLI (`claude`, `codex`, `cursor`) on a loop until a target-repo spec is complete, the user kills it, or all agents are out of quota.

The repository has been split into three areas:
- The root contains shared glue, configuration, and the public docs
- `v1/` contains the current shipping harness implementation (source, tests, specs, scripts, and data)
- `v2/` contains planning materials for the next version and reserved space for future v2 implementation

Work in this repository is work on the harness itself. The v1 implementation lives under `v1/`. Future v2 work will land under `v2/src` and `v2/test` once implementation begins.

## Core decisions

- **Name**: `jarvis`
- **Language/runtime**: TypeScript on Bun. Strict typing from day one (`strict: true`, `noUncheckedIndexedAccess: true`, etc.).
- **Distribution**: personal use; clone this repo and symlink the binary onto `PATH`. No npm publish.
- **Config location**: `~/.jarvis/config.json`. Auto-bootstrapped (idempotent) whenever jarvis runs. A separate `jarvis1 config` command edits it. The config also holds a registry of projects: `jarvis1 init` records the target repo's root in this registry, and `jarvis1 run <spec>` resolves the working directory by matching the spec path against registered project roots.
- **Default agent fallback order**: `claude → codex → cursor`. Configurable.
- **Spec format (in target repos)**: Markdown with GitHub-style task list checkboxes. Completion = zero unchecked `- [ ]` items remain.
- **Stop conditions**: spec complete, all agents quota-exhausted, or manual kill (Ctrl-C).
- **Quota detection**: per-agent stderr/exit-code heuristics documented in `v1/docs/quota-signals.md`.

## The loop prompt (sent to the agent each iteration)

Minimal. Roughly:

```
Inspect the target repo for guidance, conventions, and relevant docs.
Read the spec at <SPEC_PATH>.
Follow these Jarvis rules:
<v1/src/modes/patch/rules.md>
Pick the single most important unchecked task and complete it.
```

Target-repo guidance discovery is delegated to the underlying agent. Jarvis-owned rules for patch mode live in `v1/src/modes/patch/rules.md` and are injected inline.

## Conventions for spec files in *this* repo

- V1 implementation specs live under `v1/spec/`; v2 planning material lives under `v2/spec/`.
- Multi-file specs go in a subdirectory with an `index.md` (new trees use a basename `YYYY-MM-DDTHH-mm-ssZ-<name>/`, filesystem-safe UTC — see [v1/docs/spec-guidance.md](v1/docs/spec-guidance.md); older repos may still show date-only folders like `v1/spec/2026-05-11-v1/`).
- The index is the routing file an agent reads to select work. It contains a checklist of subspec pointers; a subspec is complete when its checkbox is checked.
- Each subspec is **atomic and testable**: it can be implemented and verified independently of the others.
- Each subspec includes a **Documentation updates** section. Doc changes are part of the work, not a follow-up.
- External agents that need to create specs should follow [v1/docs/spec-guidance.md](v1/docs/spec-guidance.md).

## Working rules for agents in this repo

- Before updating `jarvis`, make sure there is a spec for the intended change. If no spec exists, create one first using the conventions in [v1/docs/spec-guidance.md](v1/docs/spec-guidance.md).
- New specs must be committed to `main` (via a normal PR) **before** any implementation work on them begins. Jarvis runs against the spec on disk; partially drafted specs in feature branches lead to drift between the spec and the implementation. Open the spec PR, get it merged, then start a separate run/branch for the implementation.
- If a spec already exists for the intended change, run it through `jarvis1` instead of implementing it directly.
- Read the index to choose the next unchecked subspec, then read that subspec before editing.
- Run `bun run typecheck` and `bun test` before ticking the acceptance criteria they cover.
- To flip a PR from draft to ready, run `bun run ready` instead—this is the draft→ready gate distinct from the per-iteration `typecheck`/`test` loop. The ready script runs `install → check:fix → typecheck → test → check` (first installing dependencies with the frozen lockfile so Biome is available, then applying Biome's safe format and lint-rule fixer, then the remaining CI-equivalent steps) and enforces a 10-minute wall-clock deadline across all five steps; override via `JARVIS_READY_TIMEOUT_MS` (in milliseconds) if a step legitimately requires more time.
- Tick `- [ ]` items inside the subspec's `## Acceptance criteria` section as you actually satisfy them. Do not tick speculatively. The other checklist sections (`## Task Checklist`, etc.) are informational; Jarvis does not consult them.
- Do not edit `index.md`. Do not run `git commit`. Jarvis flips the index checkbox and creates the commit itself when all acceptance criteria in the active subspec are checked; partial iterations get a `WIP:` commit. Manual edits or commits will be staged into Jarvis's commit by `git add -A` in unexpected ways.
- If blocked or ambiguous, append a `## Blocker` section to the subspec and stop rather than guessing.
- Do not modify the harness behavior in ways the active subspec doesn't authorize.
- Keep changes minimal; no speculative refactors or abstractions.

## PR attribution

When Jarvis creates a draft PR, it appends an attribution footer to the PR body recording which agents produced the subspec commits on the PR branch. The footer is stamped by the harness itself, not requested of the agent, and is rendered from `Jarvis-Agent: <label>` git trailers that jarvis writes onto every commit it creates.

- **Source**: per-commit `Jarvis-Agent` trailers on commits between the PR base branch and `HEAD`. Only commits whose first body line begins with `Spec: ` (i.e. subspec commits, not `WIP:` commits) are rendered. The trailer value is exactly the agent's `attributionLabel()`. The harness may emit a single `chore: apply pre-ready check:fix` commit immediately before marking the PR ready; this commit has no `Spec:` body line and is excluded from the per-commit attribution list. Its `Jarvis-Agent:` trailer is still included in the summary attribution line.
- **Per-commit list**: chronological (oldest first), one bullet per subspec commit:
  `- <short sha> <commit subject> — <agent label>`. Commits without a `Jarvis-Agent` trailer are listed with `unknown` as the label. Multiple `Jarvis-Agent` trailers on the same commit are joined with `, `.
- **Summary line**: a deduped, first-appearance-ordered list of labels: `Written by <Label A>, <Label B>, <Label C> through Jarvis.`. When only one unique label is present this collapses to `Written by <Label> through Jarvis.` (matching the historical single-line format). When no labelled commits exist the summary line is omitted.
- **Agent labels**: Each agent's `attributionLabel()` method returns a human-readable identifier for its configured model. If the model is unknown, the raw model string is used. If no model is configured, the default fallback is `<cli-name> (default model)`.
- **Composition**: `ensureDraftPr` in `v1/src/pr.ts` appends the rendered footer to the body with a markdown `---` separator. When the footer is empty (no subspec commits on the branch) no separator or footer is appended.
- **Plan mode**: Plan-mode PRs collapse consecutive meta-commits (`plan: interview`, `plan: draft`, `plan: review N`, `plan: blocker`) into a single summary line rather than listing each individually. This reduces visual clutter for plan-mode PRs before implementation work lands (which may introduce 5+ meta-commits before any subspec commits exist). Subspec commits on plan-mode branches are rendered individually. See [docs/plan-mode.md § PR lifecycle](docs/plan-mode.md#pr-lifecycle) for details.
