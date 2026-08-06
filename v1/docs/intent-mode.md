# Intent Mode

Reference for `jarvis1 intent <raw-seed-file|"inline text">`: how one seed fans out into authored intents for later `jarvis1 plan` runs.

## Overview

Intent mode exists to size work *before* planning. One seed becomes N behavior-level intents. Each later intent should draft into one spec, and each spec should still map to one PR.

Flow:

```text
jarvis1 intent "<prompt>"        (or <targetDir>/seeds/<seed>.md)
  → split into N behavior-level intents
  → write N files to <targetDir>/ready-intents/
  → commit
  → open draft PR for split review
  → flip the PR ready for operator review
```

Intent mode does **not** run refine, does **not** draft spec directories, and does **not** write `index.md` or numbered subspec files. The operator reviews the split itself on the intent PR, then runs `jarvis1 plan` on one emitted intent at a time.

## Seed forms

Fresh intent runs require one seed:

- Inline text: `jarvis1 intent "Split the reporting overhaul into reviewable behaviors"`
- Raw-seed file: `jarvis1 intent <targetDir>/seeds/reporting-overhaul.md` (committed mode) or `jarvis1 intent ~/.jarvis/specs/<project-safe-id>/seeds/reporting-overhaul.md` (no-commit mode)

Existing files are treated as file seeds only when they exist on disk. The file-seed input directory depends on the commit mode:

- **Committed mode (`commit: true`):** File seeds must live under `<targetDir>/seeds/`.
- **No-commit mode (`commit: false`):** File seeds must live under `~/.jarvis/specs/<project-safe-id>/seeds/`.

Inline seeds have no file to consume. A successful file-seed fan-out consumes the seed: committed mode deletes its mapped worktree copy before the split commit, while no-commit mode deletes it only after every ready-intent lands. Collisions, validation failures, and publication failures leave file seeds in place. Missing, external, or symlink-escaped mapped targets are skipped.

`<targetDir>` resolves with per-run override: `--target-dir <dir>` (if provided) takes precedence over project-level `plan.targetDir`, then global `modes.plan.targetDir`, then the default `spec`. Validation mirrors `jarvis1 plan --target-dir`: relative paths only, no absolute paths, no `..` traversal. In no-commit mode, `--target-dir` no longer affects the seed-input directory validation (seeds are always validated against the external home).

Command-line usage:
```text
jarvis1 intent "seed text"
jarvis1 intent --target-dir v2/spec <targetDir>/seeds/seed.md
jarvis1 intent --repo <name> --target-dir <dir> <seed>
```

## Output

Intent mode writes authored intents under `<targetDir>/ready-intents/`.

Each emitted file:

- is named `<name>.md`
- declares matching frontmatter `name: <name>`
- includes a `## Prerequisites` section
- uses one bullet line per prerequisite behavior when prerequisites are non-empty

The emit contract is harness-enforced with deterministic repair. Missing or mismatched frontmatter `name:` and a missing `## Prerequisites` section are repaired before validation — `name:` is rewritten to match the filename slug, an empty `## Prerequisites` section is appended when absent, and blank-line spacing around an exact `## Prerequisites` heading is normalized to one blank line before and after. A near-miss heading (e.g., `### Prerequisites` or `## prerequisites`) is treated as absent and receives an empty section; it is not promoted. Malformed `## Prerequisites` bodies (non-bullet text) remain a hard error and abort without partial writes.

Two self-inflicted lint violations are fixed in-TypeScript before autofix runs: trailing blank lines are trimmed before appending `## Prerequisites` (fixes `MD012` consecutive-blank-lines), and issue references (e.g., `#499`) are kept off line-start by prefixing them with "See: " (prevents `MD018` space-in-heading autofix from promoting them to headings). After structural repair, all staged intent files receive a `markdownlint --fix` pass using the harness-pinned binary and config (cwd anchored to harness root, so target-repo config does not override the rule set); autofix is a general net and applies only, never fails on residual non-autofixable violations. Spawn failure or absent binary warns but continues with the in-TypeScript-repaired content.

`name:` collisions are hard errors. If `<targetDir>/ready-intents/<name>.md` already exists, the run aborts without overwriting files and without opening a PR. Disallowed filenames (ordering prefixes, `index`, characters outside `[a-z0-9-]`) also abort as structural errors.

## Split rule

Split by module-boundary surface, not by symptom: one ready-intent per surface the seed touches, in dependency order. A single-surface seed still emits exactly one intent. Full contract: [v2/docs/workflow-runner.md § Execution contract](../v2/docs/workflow-runner.md#execution-contract) ("Intent split contract").

Reviewability still lives at the spec/PR level: one spec per PR stays the rule. The lever is the *count* of specs, so intent mode changes how many future specs/PRs get drafted, not the one-PR-per-spec rule itself.

## Runtime behavior

Intent mode reuses the existing plan-mode plumbing:

- the same repo resolution and log-server preflight as other top-level modes
- the same plan agent order and quota fallback rules as plan mode
- intent-split inner loops also advance on `model_config` (per-agent environment noise may be agent-specific); rotation stderr uses `intent: <agent>: model configuration error; falling back`

Splitter output is staged first, mechanically repaired (frontmatter `name:` and `## Prerequisites`), and validated before anything moves into `ready-intents/`. Structural errors (bad filenames, duplicates, malformed prerequisites, no files) abort the run without partial `ready-intents/` writes and without opening a PR.

### Committed-plan mode (`commit: true`)

When `modes.plan.commit` is `true` (default), intent mode creates a dedicated git worktree/branch for the split commit and draft PR, and uses the shared draft-PR helper used elsewhere in v1. On successful completion, the split PR automatically flips from draft to ready immediately after push, without waiting for local gates, base freshness checks, or remote checks. The operator handles any failures on the PR.

### No-commit mode (`commit: false`)

When `modes.plan.commit` is `false`, intent mode writes authored intents to an external Jarvis-managed directory (`~/.jarvis/specs/<project-safe-id>/ready-intents/`) and skips worktree/branch/commit/push/PR operations. This enables intent splitting in isolated setups (no-git project roots or `git: false` configurations). The splitter runs with `--add-dir` access to a temporary external staging directory, writes-effective only for adapters supporting additional readable directories (claude, codex). On completion, the operator receives absolute-path `jarvis1 plan --repo <project> <path>` next-step commands per emitted intent. Fallback to cursor/opencode agents writes no files and fails validation (inherited `--add-dir` limitation).
