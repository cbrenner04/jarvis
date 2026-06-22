# Intent Mode

Reference for `jarvis1 intent <raw-seed-file|"inline text">`: how one seed
fans out into authored intents for later `jarvis1 plan` runs.

## Overview

Intent mode exists to size work *before* planning. One seed becomes N
behavior-level intents. Each later intent should draft into one spec, and each
spec should still map to one PR.

Flow:

```text
jarvis1 intent "<prompt>"        (or <targetDir>/wip-intents/<seed>.md)
  → split into N behavior-level intents
  → write N files to <targetDir>/ready-intents/
  → commit
  → open draft PR for split review
```

Intent mode does **not** run refine, does **not** draft spec directories, and
does **not** write `index.md` or numbered subspec files. The operator reviews
the split itself on the intent PR, then runs `jarvis1 plan` on one emitted
intent at a time.

## Seed forms

Fresh intent runs require one seed:

- Inline text: `jarvis1 intent "Split the reporting overhaul into reviewable behaviors"`
- Raw-seed file: `jarvis1 intent <targetDir>/wip-intents/reporting-overhaul.md`

Existing files are treated as file seeds only when they exist on disk. File
seeds must live under `<targetDir>/wip-intents/`. The raw seed is read but left
in place after fan-out.

`<targetDir>` resolves the same way plan mode does: per-run override is not
supported here, so intent mode uses the configured committed plan root
(`projects.<key>.plan.targetDir`, then `modes.plan.targetDir`, then `spec`).

## Output

Intent mode writes authored intents under `<targetDir>/ready-intents/`.

Each emitted file:

- is named `<name>.md`
- declares matching frontmatter `name: <name>`
- includes a `## Prerequisites` section
- uses one bullet line per prerequisite behavior when prerequisites are non-empty

The emit contract is harness-enforced with deterministic repair. Missing or
mismatched frontmatter `name:` and a missing `## Prerequisites` section are
repaired before validation — `name:` is rewritten to match the filename slug,
and an empty `## Prerequisites` section is appended when absent. A near-miss
heading (e.g., `### Prerequisites` or `## prerequisites`) is treated as absent
and receives an empty section; it is not promoted. Malformed `## Prerequisites`
bodies (non-bullet text) remain a hard error and abort without partial writes.

`name:` collisions are hard errors. If `<targetDir>/ready-intents/<name>.md`
already exists, the run aborts without overwriting files and without opening a
PR. Disallowed filenames (ordering prefixes, `index`, characters outside
`[a-z0-9-]`) also abort as structural errors.

## Split rule

Split by independently observable behavior. Prefer vertical slices over
umbrella bundles. If the seed is already one behavior, emit exactly one intent.

Reviewability still lives at the spec/PR level: one spec per PR stays the rule.
The lever is the *count* of specs, so intent mode changes how many future
specs/PRs get drafted, not the one-PR-per-spec rule itself.

## Runtime behavior

Intent mode reuses the existing plan-mode plumbing:

- the same repo resolution and log-server preflight as other top-level modes
- the same plan agent order and quota fallback rules as plan mode

Splitter output is staged first, mechanically repaired (frontmatter `name:` and
`## Prerequisites`), and validated before anything moves into `ready-intents/`.
Structural errors (bad filenames, duplicates, malformed prerequisites, no files)
abort the run without partial `ready-intents/` writes and without opening a PR.

### Committed-plan mode (`commit: true`)

When `modes.plan.commit` is `true` (default), intent mode creates a dedicated
git worktree/branch for the split commit and draft PR, and uses the shared
draft-PR helper used elsewhere in v1.

### No-commit mode (`commit: false`)

When `modes.plan.commit` is `false`, intent mode writes authored intents to an
external Jarvis-managed directory (`~/.jarvis/specs/<project-safe-id>/ready-intents/`)
and skips worktree/branch/commit/push/PR operations. This enables intent splitting
in isolated setups (no-git project roots or `git: false` configurations). The
splitter runs with `--add-dir` access to a temporary external staging directory,
writes-effective only for adapters supporting additional readable directories
(claude, codex). On completion, the operator receives absolute-path
`jarvis1 plan --repo <project> <path>` next-step commands per emitted intent.
Fallback to cursor/opencode agents writes no files and fails validation
(inherited `--add-dir` limitation).
