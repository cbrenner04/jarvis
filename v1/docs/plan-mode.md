# Plan Mode

Reference for `jarvis1 plan <intent-file|"inline text">` semantics: how it creates draft specs, how the phases work, and when it stops.

## Overview

Plan mode creates a dedicated worktree and branch (`plan/<plan-name>` and `.worktree/plan-<plan-name>/`; **no UTC prefix**) to draft a new spec collaboratively with an agent. The location where specs are written depends on the `modes.plan.commit` config setting and the configured `targetDir`:

**With `commit: true` (default):** Specs are written inside the target repository under `<targetDir>/<spec-dir>/` where `<targetDir>` defaults to `spec` but may be configured per-project:
- A seeded `<targetDir>/<spec-dir>/intent.md` capturing the user's initial request. New runs use **`<targetDir>/YYYY-MM-DDTHH-mm-ssZ-<plan-name>/`** (`<plan-name>` is the validated kebab-case name after collisions). Older trees may still omit the timestamp (**`<spec-dir>`** = `<plan-name>` only); both layouts stay valid for resume and `jarvis1 run`.
- A `plan: intent` commit after intent draft (proposed `name:`, preserved raw seed).
- A `plan: refine` commit when `--refine-turns > 0`.
- A `plan: draft` commit with `<targetDir>/<spec-dir>/index.md` plus atomic subspec files (after `--resume-draft`).
- Zero or more `plan: review <N>` commits (default 2) where agents refine the spec tree in place.
- A draft PR titled `plan: <plan-name>` (derived from branch identity, **not** the UTC prefix) that aggregates progress across all phases. On fresh seeded runs the PR opens after `plan: intent` (and `plan: refine` when refinement runs); draft/review continue after `--resume-draft`.

**With `commit: false`:** Specs are written in Jarvis-owned storage outside the target repository:
- The target directory must be a registered project (via `jarvis1 init` or `jarvis1 config`).
- Specs live at `~/.jarvis/specs/<project-safe-id>/<spec-dir>/` (where `<project-safe-id>` is the registered project key, origin-derived slug, or root basename).
- No git branch or worktree is created; plan mode runs in the target directory root.
- No commits, pushes, or draft PR are created.
- The generated `index.md` includes a `repo:` binding so `jarvis1 run` can resolve the target repository.

**With `commit: true`:** Fresh seeded runs stop after `plan: intent` (and `plan: refine` when `--refine-turns > 0`): jarvis opens or updates the branch's open draft PR, prints review-then-`--resume-draft` next steps, and exits **`0`**. After `--resume-draft`, draft and review run; when every phase succeeds without a blocker, **`gh pr ready` runs automatically** (same readiness transition as patch mode).

**Stdout Next steps (committed fresh-run handoff):** after `plan: intent` / `plan: refine`, jarvis prints the PR URL and `jarvis1 plan --resume-draft <targetDir>/<spec-dir>/intent.md` only — not merge/run commands yet.

**Stdout Next steps (full pipeline complete):** after draft/review succeed, jarvis prints the PR URL plus exact `jarvis1 plan --resume …` and `jarvis1 run …` commands using **`<targetDir>/<spec-dir>/` paths** (e.g., `spec/…` for default repos, `v1/spec/…` for configured roots). That block deliberately **does not** ask you to toggle draft/readiness manually.

Operator/workflow decisions for the committed fresh-run handoff, PR scoping, and `--resume-draft` blocker rules are summarized in [v2/docs/v1-behaviors.md](../../v2/docs/v1-behaviors.md) (plan-mode bullets and flow matrix); this doc is the primary phase reference.

**With `commit: false`:** There is no PR. **Stdout Next steps:** jarvis prints the absolute path to the external spec (e.g., `~/.jarvis/specs/groceries/2026-05-18T14-30-45Z-feature/index.md`) plus exact `jarvis1 plan --resume …` and `jarvis1 run …` commands using that absolute path.

Unlike `jarvis1 run`, which expects specs to be complete before PR readiness, plan mode drafts incomplete specs: you review/edit on the PR, then merge to `main`; after merging, **`jarvis1 run <targetDir>/<spec-dir>/index.md`** implements it (e.g., `jarvis1 run spec/…` or `jarvis1 run v1/spec/…` depending on your repo's configuration).

Plan mode is useful for:

- **Collaborative spec authoring**: agents draft specs from high-level intent, then refine them in multiple self-review passes.
- **Non-interactive automation**: `jarvis1 plan intent.md` and `jarvis1 plan "inline text"` work end-to-end without human prompts.
- **Spec validation before work**: review and edit the generated spec before implementation begins.


## Names and paths

- **`<plan-name>`** — The collision-suffixed kebab-case slug backing **`plan/<plan-name>`** and `.worktree/plan-<plan-name>/`; it **never** includes the filesystem timestamp segment.
- **`<targetDir>`** — Root directory for committed specs, configured per-project or globally (default `"spec"`). See [config.md](./config.md#targetdir-plan-mode-committrue-only) for details.
- **`<spec-dir>`** — Directory basename under **`<targetDir>/`** hosting `intent.md` / `index.md`. New runs mint **`YYYY-MM-DDTHH-mm-ssZ-<plan-name>`**; legacy trees may still flatten to **`<plan-name>`** alone. Resume + `jarvis1 run` honor both layouts.

After merge, **`jarvis1 run <targetDir>/<spec-dir>/index.md`** consumes the finalized tree (**`<spec-dir>`** keeps the UTC prefix when plan mode created one). For a default repo this is `spec/…`; for a configured root like `v1/spec/` it is `v1/spec/…`.

## Default terminal output

Successful runs omit chatty setup breadcrumbs by default (inline intent echoes,
temporary slug previews, provisional worktrees, rename chatter). Harness /
session logs still capture those details.

**With `commit: true`:** Typical milestone stderr lines look like **`plan: intent commit pushed`**,
**`plan: refine commit pushed`**, **`plan: draft phase completed`**, **`plan: draft commit pushed`**,
**`plan: draft PR #… opened`**, and review notifications such as
**`plan: review pass k/n starting`** then **`plan: review pass k committed
and pushed`**. Blockers, validation failures, quota/model errors, and agent stderr
stay visible untouched.

Stdout ends with the **committed fresh-run handoff** block (review PR, then `--resume-draft`):

```text
Next steps:
  1. Review the draft PR: https://…
  2. When ready to draft subspecs, run:
       jarvis1 plan --resume-draft <targetDir>/<spec-dir>/intent.md
```

After draft/review complete successfully, stdout instead prints the **full pipeline** merge/resume/run block:

```text
Next steps:
  1. Review the draft PR: https://…
  2. Edit <targetDir>/<spec-dir>/ …
 … `jarvis1 plan --resume <targetDir>/<spec-dir>/index.md`
 … merge … `jarvis1 run <targetDir>/<spec-dir>/index.md`
```

where `<targetDir>` is the configured plan root (e.g., `spec` for default repos, `v1/spec` for this repository).

Notice there is **no** third bullet telling reviewers to toggle draft/readiness —
jarvis performs that readiness transition programmatically whenever every phase
succeeds.

**With `commit: false`:** Milestone stderr lines for refine, naming, draft, and review are similar
(the target directory does not need to be a git repository; no "commit pushed" or "PR opened" steps since there is no GitHub integration). 

Stdout ends with:

```text
Next steps:
  1. External spec: ~/.jarvis/specs/groceries/2026-05-18T14-30-45Z-feature/index.md
  2. Run implementation: jarvis1 run ~/.jarvis/specs/groceries/2026-05-18T14-30-45Z-feature/index.md
 … `jarvis1 plan --resume ~/.jarvis/specs/groceries/2026-05-18T14-30-45Z-feature/index.md`
```

## Input modes

Plan mode accepts intent in two forms. Fresh runs require a seed.

### File mode

```sh
jarvis1 plan spec/2026-05-17T22-14-03Z-my-feature/intent.md
```

or, for a repository configured to use a non-default `targetDir`:

```sh
jarvis1 plan v1/spec/2026-05-17T22-14-03Z-my-feature/intent.md
```

Older date-only prefixes (for example **`spec/2026-05-11-v1/intent.md`** or **`v1/spec/2026-05-11-v1/intent.md`**) remain valid authoring inputs; **[docs/spec-guidance.md](./spec-guidance.md)** captures the canonical timestamp shape for newly created trees. Plan mode does not require running from any specific directory — the intent file path is resolved from the current working directory.

### Inline mode

```sh
jarvis1 plan "Add dark mode toggle to the app settings"
```

Inline text now enters the same fresh-run pipeline as file seeds: jarvis seeds `intent.md`, runs one intent-draft pass to propose `name:` and shape the draft, then continues into refine/draft/review according to the normal fresh-run flow.

## Phases

Plan mode executes these phases in order:

### Prompt ownership

Relocation stage one moved the five editable plan prompt templates to the
shared repo-level `prompts/plan/` tree:

- `prompts/plan/refine.md`
- `prompts/plan/intent-draft.md`
- `prompts/plan/name-only.md`
- `prompts/plan/draft.md`
- `prompts/plan/review.md`
- `prompts/plan/review-actuator.md`

The corresponding `v1/src/modes/plan/*.ts` files remain loader/runtime logic:
template loading, rewrite handling, and non-recursive rendering behavior.

This move is relocation-only and keeps prompt composition semantics unchanged:
no wording edits, prompt IDs, registries, metadata expansion, or snapshot
revision system are introduced here. Interactive/operator prompt surfaces such
as project disambiguation remain out of scope for this stage.

### Phase 0: Intent Draft

Fresh seeded runs always start by writing `intent.md` under the temporary spec directory, preserving the exact raw seed in a dedicated block and ensuring the file has frontmatter with `name:` plus any preserved non-`name` keys from a file seed.

Jarvis then runs one non-interactive intent-draft pass that:

- inspects the target repo for guidance,
- rewrites `intent.md` into a rough editable draft,
- preserves the exact raw-seed block byte-for-byte, and
- proposes `name: <kebab-case>` in frontmatter.

If the proposed name is missing or invalid, jarvis falls back to deterministic seed-derived naming before collision suffixing. Jarvis then renames the temporary worktree/branch to final identities (`.worktree/plan-<plan-name>/`, `plan/<plan-name>`) and, when `commit: true`, pushes **`plan: intent`**.

**Commit shape (`plan: intent`):**
- Subject: `plan: intent`
- Body: starts with **`Spec: <targetDir>/<spec-dir>/intent.md`**, followed by `Seeded from <intent path or "inline">`.
- `Jarvis-Agent` trailer: the intent-draft agent label.
- Pushed: immediately after commit (first push sets upstream).

### Phase 1: Intent Refinement

**With `commit: true`:** Refinement runs on the final `plan/<plan-name>` branch after `plan: intent` is pushed (`--refine-turns`, default `1`).

**With `commit: false`:** Jarvis creates the spec directory in Jarvis-owned storage (`~/.jarvis/specs/<project-safe-id>/<spec-dir>/`) and continues in one invocation through intent draft, refine, draft, and review with no git or PR handoff.

Each turn is one non-interactive agent invocation. The prompt asks the agent to inspect the target repo as needed and refine `intent.md` by appending useful planning context: inferred constraints, assumptions, scope boundaries, risks, or draft-shaping notes. Refinement entries must be net-new versus prior entries; if a turn would only restate prior content, use `## Refine skip`. It cannot ask the terminal user questions or record a Q&A transcript. With `quotaFallback: "lenient"`, weak-quota fallback to the next agent runs only when **`git status --porcelain`** matches before and after that invocation (no disk mutations during the attempt); see [quota-signals.md](./quota-signals.md).

After each turn, jarvis validates that `intent.md` preserves the post-seed layout above the first `## Refinement` heading (`## Raw seed` with its `<details>`/`<summary>` wrapper, raw-seed markers, and `## Intent` byte-for-byte) and then leaves one permitted outcome: consolidated `## Refinement` ledger content, `## Refine skip` when no useful refinement is needed, or `## Blocker` when drafting would need human clarification.

Intent refinement no longer owns naming. `name:` is proposed in the intent-draft step. If `--refine-turns 0` is used, jarvis skips refinement entirely after `plan: intent`.

Once refinement finishes (or is skipped), jarvis commits and pushes **`plan: refine`** when `commit: true` and `--refine-turns > 0`. The temporary branch is never pushed before rename.

**Commit shape (`plan: refine`):**
- Subject: `plan: refine`
- Body: starts with **`Spec: <targetDir>/<spec-dir>/intent.md`**, followed by `Turns: <n>` and optional `Outcome: explicit skip` / `Outcome: blocker`.
- Pushed: immediately after commit.

### Committed fresh-run handoff (after refine)

For fresh `commit: true` seeded runs (file or inline), jarvis stops after `plan: intent` (and `plan: refine` when `--refine-turns > 0`): it opens or updates the branch's **open** draft PR, prints review-then-`--resume-draft` next steps, and exits **`0`**. No synthetic `## Blocker` is appended. Draft/review agent phases run only after:

```sh
jarvis1 plan --resume-draft <targetDir>/<spec-dir>/intent.md
```

See [v2/docs/v1-behaviors.md](../../v2/docs/v1-behaviors.md) for the flow matrix and `--resume-draft` legacy-blocker rule.

### Phase 2: Draft

After `plan: refine` is pushed and the operator continues via `--resume-draft`, jarvis invokes an agent with a focused prompt (`prompts/plan/draft.md`) that:

- Inlines `intent.md` and `docs/spec-guidance.md`.
- Asks the agent to read the target repo for context.
- Instructs the agent to produce `spec/<spec-dir>/index.md` plus one or more atomic subspecs (`00-*.md`, `01-*.md`, etc.).
- Forbids modifications to `intent.md` except for appending a `## Blocker` section.

The agent produces files under `spec/<spec-dir>/` in the worktree. Jarvis does **not** invoke the agent a second time; the call ends when the agent ends. The produced files are staged and committed as `plan: draft`.

**Prompt rendering:** Plan prompt builders use non-recursive template rendering, so placeholder-looking text in injected values (intent, spec name, etc.) is treated as literal data. For example, if the intent documents exact placeholder tokens like `<SPEC_GUIDANCE>`, those strings appear verbatim in the final prompt without escaping or recursive substitution. This allows spec-governance and prompt-documentation content to reference exact placeholder names.
Rendered prompt snapshots for this phase are reviewed from revision-keyed
fixtures (`v1/test/fixtures/prompts/rendered/<id>@r<revision>...shared.txt`).

**Commit shape:**
- Subject: `plan: draft`
- Body:
  ```
  Spec: spec/<spec-dir>/intent.md

  Drafted by <agent-attribution>.
  Subspecs: <count>
  ```
  Where `<agent-attribution>` is the agent's `attributionLabel()` (also written as the `Jarvis-Agent` git trailer) and `<count>` is the number of subspec files (files matching `spec/<spec-dir>/[0-9]*.md`, excluding `index.md` and `intent.md`). The leading `Spec: ` line lets the attribution renderer in `src/pr.ts` pick the commit up.
- Pushed: immediately after commit.

**Blocker handling:** If the agent appends a `## Blocker` section to `intent.md` during draft, the draft files are first committed as `plan: draft` (per the normal commit shape above) and then a separate `plan: blocker` commit captures the blocker; plan mode stops (see [Stop conditions](#stop-conditions)).

### Phase 3: Self-review

After `plan: draft` is pushed, jarvis runs zero or more review cycles (default: `modes.review.passes`, currently `2`; overridable via `--review-passes`). Review agents come from `modes.review.agentOrder`, falling back to `modes.plan.agentOrder`. Each cycle runs read-only adversary, advocate, and adjudicator prompts (`prompts/plan/review-*.md`). The adjudicator writes a self-contained verdict; when non-empty, jarvis persists it as `verdict-plan.md` and invokes the actuator prompt (`prompts/plan/review-actuator.md`) to apply the verdict to generated spec files.

Reviewer role prompts:

- Inlines the current `intent.md` and all spec files.
- Inlines `docs/spec-guidance.md`.
- Ask the agent to critique, defend, then adjudicate the current spec tree against the intent and guidance.
- Revert any spec edits made by reviewer roles; reviewers are read-only.
- Pass role artifacts forward inside the cycle: adversary findings → advocate, advocate response → adjudicator.

The actuator prompt:

- Inlines the current `intent.md`, all generated spec files, `docs/spec-guidance.md`, and the verdict.
- Asks the agent to edit the generated spec files in place with targeted changes that satisfy the verdict.
- Forbids editing `verdict-plan.md` and forbids creation of unrelated files.
- Forbids modifications to `intent.md` except for appending a `## Blocker` section.

Each cycle is bounded by the configured pass count; the agents do not decide when to stop or how many cycles to run. Non-empty role and actuator artifacts are staged and committed as `plan: review: <role>` / `plan: review: actuator` (with resume suffixes when applicable). Empty verdicts skip the actuator and produce no actuator commit.

**Prompt rendering:** Like the draft phase, review prompts use non-recursive template rendering so that placeholder-looking text in the current spec (e.g., `<CURRENT_SPEC>` appearing in the snapshot) is treated as literal data without recursive substitution.
Review role and actuator variants are snapshot-tested so wording and delimiter boundaries are review-visible.

**Commit shape (for actuator):**
- Subject: `plan: review: actuator`
- Body:
  ```
  Spec: spec/<spec-dir>/intent.md

  Reviewed by <agent-attribution>.
  ```
- Pushed: immediately after commit.

**Blocker handling:** If the agent appends a `## Blocker` section to `intent.md` during a review pass, that pass's edits are committed as `plan: review <N>` and plan mode stops (see [Stop conditions](#stop-conditions)).

**`--review-passes 0`:** Skips all review passes entirely; only the draft phase and `plan: refine` commit exist. Useful for fast feedback or when self-review is not desired.

## Usage summaries

When at least one plan-phase agent invocation writes telemetry, Jarvis appends a **plan summary** block to stdout on exit. On successful completion, this appears after the "Next steps" section so the existing completion output stays intact.

Coverage:

- **Phases**: intent draft, intent-refinement turns, draft, and each review pass—all agent attempts participate in the same telemetry stream.

- **Telemetry**: Rows use the configured `telemetryPath` JSONL file (same file as `jarvis1 run`), with **`mode: "plan"`** and **`plan_phase`** set to `intent`, `refine`, `name-only`, `draft`, or `review`. Intent and refine rows may include **`outcome`**: `success` (intent draft validated), `refined` (refine produced a refinement ledger), `skip` (refine appended `## Refine skip`), or `blocker` (refine appended `## Blocker`). Failed intent/refine attempts omit `outcome`. Patch summaries ignore these rows; plan summaries ignore patch rows, so both modes can coexist in one file.

- **Labels**: The summary header reports **`phase attempts`** (count of non-`harness`, non-`run_terminal` invocation rows), not patch-style implementation iterations. Table rows use **`N attempt(s)`** per agent instead of **`N iteration(s)`**.

- **Cost**: Usage-only agent results get cost computed from the configured model id for each attempt (`modes.plan.agentOrder` for refine/draft/name-only; review uses `modes.review.agentOrder ?? modes.plan.agentOrder`) when the price table has a matching entry—the same enrichment path as patch mode (`modes.patch.agentOrder` there). Shared terminology for token buckets, `cost_source`, and notes is documented under [Token usage and cost tracking](./run-loop.md#token-usage-and-cost-tracking) and [End-of-run summary](./run-loop.md#end-of-run-summary).

- **Quota fallback**: Quota-only attempts are excluded from aggregated totals with the same quota-excluded notes as patch mode.

No summary is printed for configuration or project-resolution failures that occur **before** any agent invocation.

## PR body updates

The draft PR opens after the first committed fresh-run handoff (`plan: intent`, and `plan: refine` when refinement runs) or after the first `plan: draft` commit on `--resume-draft` paths. The PR body contains:

1. **Header**: The spec title (from `index.md` if available) plus file references.
2. **Narrative section**: A model-authored short description followed by `Decisions:` and an unordered list of notable decisions. This section is bounded by `<!-- jarvis:narrative:start -->` and `<!-- jarvis:narrative:end -->` markers for preservation.
3. **Attribution footer**: Sourced from `Jarvis-Agent` trailers on all plan commits on the branch (including `plan: intent`, `plan: refine`, `plan: draft`, and `plan: review N`).

Each subsequent `plan: ...` commit triggers a PR-body rewrite that rebuilds the header and footer while:

- Preserving human-written narrative inside the markers verbatim.
- Regenerating the narrative when the section is empty or still machine-owned (no human edits detected).

This contract mirrors patch mode's narrative preservation semantics: humans can edit the narrative between markers across rewrite cycles, and the markers protect those edits from being overwritten by automated regeneration.

## Configuration: `modes.plan.commit`

The `modes.plan.commit` boolean (config v2) controls where plan-mode specs are written and whether git/GitHub are involved:

- **`true` (default):** Plan specs are authored in a worktree on a branch under the target repo's `spec/<spec-dir>/` tree. Git commits (`plan: intent`, `plan: refine`, `plan: draft`, `plan: review N`) are made, a draft PR is opened after the fresh-run refine handoff (or after `plan: draft` on resume paths), and `gh pr ready` runs programmatically on success. After merge to `main`, the spec is available to `jarvis1 run`.
- **`false`:** Plan specs are written to Jarvis-owned storage outside the target directory (`~/.jarvis/specs/<project-safe-id>/<spec-dir>/`). No git branch, worktree, commits, or PR are created. Plan mode runs directly in the target directory root (which may or may not be a git repository). The generated `index.md` includes a portable `repo:` binding for later `jarvis1 run` invocations.

When `commit: false`, the spec tree must include a usable `repo:` metadata line so `jarvis1 run` can later resolve the target repository independently of the spec file's location.

### `repo:` binding and origin detection

Plan mode writes a `repo:` line into the generated `index.md`. When the target project has a configured `origin` URL, that URL is used directly for portability. When `origin` is not configured but the project root is a git checkout with an `origin` remote, plan mode automatically detects that remote via `git remote get-url origin` and emits it as the portable `repo:` value. This detection is read-only and does not persist the origin back to `~/.jarvis/config.json`. On any detection failure (non-git directory, no `origin` remote, missing `git` binary, etc.), plan mode falls back silently to the registered project key, which remains resolver-safe for `jarvis1 run`.

## Flags

### `--refine-turns <n>`

Controls the intent-refinement budget. Default: `1`. `0` still runs the intent-draft step and `plan: intent`, then skips refinement entirely. There is no no-argument fresh mode.

### `--review-passes <n>`

Number of self-review passes to run. Default: `2`. Use `--review-passes 0` to skip review entirely and stop after draft.

### `--repo <name|path|url>`

Select the target repository. Same semantics as `jarvis1 run --repo`. If omitted, jarvis resolves the repo from the spec path or prompts (in TTY mode) or exits with a usage error (in non-TTY mode).

### `--cwd <dir>`

(Parsed but treated as a hint; the finalized worktree always lives under `.worktree/plan-<plan-name>/` in the target repo.) For consistency with `jarvis1 run`, this flag is accepted but has limited effect in plan mode. Produced files reside under **`spec/<spec-dir>/`** checked out inside that untimestamped plan worktree.

### `--resume <spec-path>`

Resume a previously created post-draft plan worktree and branch:

```sh
jarvis1 plan --resume spec/2026-05-17T22-14-03Z-my-plan/index.md
# legacy layouts still accepted, e.g. spec/my-plan/index.md
```

Validation rules:

- `<spec-path>` must point at `spec/<spec-dir>/index.md` on disk.
- The sibling `spec/<spec-dir>/intent.md` must exist.
- If `.worktree/plan-<plan-name>/` is missing, jarvis tries to recreate it from
  local `plan/<plan-name>` or `origin/plan/<plan-name>` and logs
  `plan: recreated worktree at <path> from <local|origin>`.
- If neither local nor remote plan branch exists, resume still fails with the
  same missing-worktree error.
- The plan worktree must have **`plan/<plan-name>`** checked out.
- `origin/plan/<plan-name>` must exist; local-only plan branches still fail the
  preserved origin requirement after any worktree recreation.

Resume does not accept positional intent text/file and does not require
`--repo`; it operates entirely from the existing plan worktree state.

### `--resume-draft <intent-path>`

Resume after the committed fresh-run refine handoff:

```sh
jarvis1 plan --resume-draft spec/2026-05-17T22-14-03Z-my-plan/intent.md
# legacy layouts still accepted, e.g. spec/my-plan/intent.md
```

Validation rules:

- `<intent-path>` must point at `spec/<spec-dir>/intent.md` on disk.
- `intent.md` must not contain a genuine `## Blocker` section. Historical review-gate blockers jarvis generated before this handoff are ignored.
- If `.worktree/plan-<plan-name>/` is missing, jarvis tries to recreate it from
  local `plan/<plan-name>` or `origin/plan/<plan-name>` and logs
  `plan: recreated worktree at <path> from <local|origin>`.
- If neither local nor remote plan branch exists, resume still fails with the
  same missing-worktree error.
- The plan worktree must have **`plan/<plan-name>`** checked out.
- `origin/plan/<plan-name>` must exist; local-only plan branches still fail the
  preserved origin requirement after any worktree recreation.

`--resume-draft` resumes with the draft phase and then review passes. It does not
accept positional inline intent text and does not require `--repo`.

## Resuming a plan

Resume runs additional phases against an existing plan branch:

- Runs `--review-passes <n>` additional review passes (default `2`), same as
  initial invocation.
- Runs no intent-refinement turns by default.
- If `--refine-turns <n>` is passed with `n > 0`, runs intent refinement first and
  continues consolidating the single `## Refinement` ledger in `intent.md`.

Resume commit subjects carry an `r<n>` suffix where `<n>` is the resume
invocation number for that plan branch:

- `plan: refine r<n>` (only when resume intent-refinement turns run)
- `plan: review <N> r<n>`
- `plan: blocker r<n>`

`<N>` remains the global review-pass number across the branch, while `r<n>`
increments once per resume invocation.

## Naming

Plan mode uses an agent-proposed spec name instead of deterministic naming by default:

- During intent draft, the agent writes `name: <kebab-case>` in `intent.md` frontmatter.
- Jarvis reads that proposal, validates/sanitizes it, and applies the uniqueness suffix loop on collisions (`-2`, `-3`, ...).
- If no valid proposal is produced in intent draft, jarvis falls back to deterministic derivation and emits a stderr note.
- Jarvis uses a temporary worktree/branch first, then renames both to final values before pushing `plan: intent`.

## Stop conditions

Plan mode stops in these cases:

### 1. All phases complete

All draft and review passes finish without encountering a blocker. Jarvis exits **`0`** and triggers **`gh pr ready`** alongside the customary stdout **Next steps** block (**which omits redundant manual ready-flip instructions**). Humans still review/modify GitHub/Git content and merge once satisfied using `jarvis1 run spec/<spec-dir>/index.md` afterward.

### 2. Blocker encountered

If an agent appends a `## Blocker` section to `spec/<spec-dir>/intent.md` (exact heading, level 2, case-sensitive), plan mode stops immediately. The current phase's edits are staged and committed as `plan: blocker` (the last plan commit for that invocation).

**Commit shape:**
- Subject: `plan: blocker`
- Body:
  ```
  Spec: spec/<spec-dir>/intent.md

  Blocked by <reason>
  Spec files to date: <count>
  Raised by <agent-attribution>.
  ```
  Where `<reason>` is the first non-empty line of the agent's `## Blocker` body and `<count>` is the number of `[0-9]*.md` subspec files at the time the blocker was committed.
- Pushed: immediately after commit.

Jarvis then prints the blocker section to stderr and exits `1`. The draft PR
reflects the blocker for human review. The user can resolve the blocker
offline, update `spec/<spec-dir>/intent.md` manually on the branch, and re-run
`jarvis1 plan --resume spec/<spec-dir>/index.md` to continue, or close the PR and
start over.

### 3. Ctrl-C

User interrupts with Ctrl-C (SIGINT). Jarvis records the signal and, at the
next interrupt-checkpoint (after the current agent invocation returns and
*before* any commit/push for that pass), exits `130` (standard POSIX exit code
for SIGINT) leaving the worktree, branch, and PR as they were on entry to that
pass. A second Ctrl-C while an agent is still running falls through to Node's
default handler and terminates the process immediately, which may leave a
partially-written file in the worktree but never an unintended commit. The
user can return to the worktree and continue manually or with
`jarvis1 plan --resume spec/2026-05-17T22-14-03Z-my-plan/index.md`.

### 4. Agent quota exhausted

Refine, draft, and name-only phases use `modes.plan.agentOrder`. Review passes use the shared review agent chain (`modes.review.agentOrder`, falling back to `modes.plan.agentOrder`). Each review pass starts a fresh agent chain (quota exhaustion on pass 1 does not remove agents from pass 2). When a selected agent reports a quota signal, jarvis advances to the next agent in that pass's chain. While rotating during refine/draft/name-only, stderr lines use the same core phrases as patch mode (`quota exhausted; falling back` and `probable quota-like error (exit N); falling back`), each prefixed with `plan: <agent>: ` for grep in mixed logs. Review quota rotation uses the same phrases with the `plan: <agent>:` prefix via `emitPlanAgentQuotaFallback`. Under `quotaFallback: "lenient"`, review also upgrades weak-quota spawn **`error`** results when git porcelain is unchanged across the invocation. If all agents are exhausted in a pass, jarvis exits `2` and prints `plan: all agents quota-exhausted` to stderr (optionally with a phase suffix such as ` during refine`), matching patch mode's quota exit code; see [docs/quota-signals.md](./quota-signals.md) and the [Classification and fallback outcome matrix](./quota-signals.md#classification-and-fallback-outcome-matrix).

If an agent reports a `model_config` signal (the configured model is not supported by that CLI/account), jarvis exits `3` and prints `plan: model configuration error` plus the agent's stderr. This matches patch mode's `model_config` exit code (see `src/modes/patch/run.ts`).

### 5. Hard generic errors (excluding quota and model configuration)

**Policy:** After spawn-time classification and any lenient weak-quota upgrade (`quotaFallback: "lenient"`), a remaining classified `error` does **not** exit the inner `modes.plan.agentOrder` loop for refine, name-only, or draft. Jarvis tries the next configured agent for the same phase invocation.

**Review (intentional divergence):** The shared review runner matches patch review: **quota** (including lenient weak-quota upgrades) rotates to the next review agent within the pass; **`model_config`** is fatal (exit `3`); other hard **`error`** results stop that pass immediately without trying siblings. This differs from pre-unification plan review, which rotated on hard errors like refine/draft. Rationale: review passes are bounded critique loops; a hard CLI failure is treated like patch review rather than retried across the full plan order.

**Difference from patch implementation:** `jarvis1 run` stops the current **implementation** iteration on the same classified `error` (typically harness exit `1`). Only **quota** rotates within a single patch iteration. Review (plan + patch) shares the runner rules above. See [Classification and fallback outcome matrix](./quota-signals.md#classification-and-fallback-outcome-matrix).

If every agent in the order fails without `ok`, the phase returns the last failure (often the last agent's `error`).

## Agent selection

Plan mode uses `config.modes.plan.agentOrder` for refine/draft/name-only (not `modes.patch.agentOrder`). Review uses `modes.review.agentOrder ?? modes.plan.agentOrder`. Config v2 requires patch and plan orders to be explicit. The quota fallback chain is the same as patch mode: if the chosen agent reports a quota signal, advance to the next in that phase's chain; if all are exhausted, exit with code and message.

There is no fallback to patch-mode order; both must be configured.

## PR lifecycle

### Draft open

On fresh `commit: true` seeded runs, jarvis opens or updates the branch's **open** draft PR after `plan: intent` (and `plan: refine` when refinement runs), before exiting with `--resume-draft` next steps. On `--resume-draft` paths where no open PR exists yet, the first `plan: draft` commit triggers the same `ensureDraftPr` helper patch mode uses. `ensureDraftPr` scopes to the current branch's open PR only — closed or unrelated PRs are not reused. GitHub renders the draft bit until **`gh pr ready` succeeds**. The PR title stays **`plan: <plan-name>`** — i.e., the slug shared with the branch (**not** the leading UTC segment of **`spec/`** paths when present). PR body internals:

1. **Deterministic header**: the H1 from `spec/<spec-dir>/index.md` (or `# Plan: <plan-name>` when the index does not yet exist), followed by bullets that cite **`spec/<spec-dir>/intent.md`** and **`spec/<spec-dir>/index.md`**.
2. **Narrative section**: a model-authored short description followed by `Decisions:` and an unordered list of notable decisions (bounded by `<!-- jarvis:narrative:start -->` and `<!-- jarvis:narrative:end -->` markers). Humans can edit the narrative between the markers; edits are preserved verbatim during PR body rewrites.
3. **Attribution footer**: rendered from `Jarvis-Agent` trailers on every plan commit on the branch. Plan-mode meta-commits (`plan: intent`, `plan: refine`, `plan: draft`, `plan: review N`, `plan: blocker`) are collapsed into a single summary line listing the count of collapsed commits and the deduped set of agents involved. Subspec commits are rendered individually, one bullet per commit, with a deduped summary line of all contributing agents.

### Auto-mark ready on success

Like patch mode, plan mode invokes `bun run ready` automatically once every
scripted phase succeeds (no blocker). The readiness transition begins with
`bun install --frozen-lockfile` so Biome is available, then runs
`bun run check:fix` (Biome's safe format and lint-rule fixer) as the second
step — which may rewrite files — before `typecheck → test → check` proceeds.

**Readiness transition behavior:**
- If the branch's open PR is **draft**, the `bun run ready` gate runs. On success, any `check:fix` output is committed and pushed (`chore: apply pre-ready check:fix`), then `gh pr ready` flips the PR to ready. On gate failure, the PR remains draft.
- If the branch's open PR is **already ready**, both the gate and GitHub transition are skipped; the PR remains ready and emits no warning.
- If **no open PR exists**, the readiness helper is a silent no-op.

**Recovery on resume:** A later successful `jarvis1 plan --resume …` invocation retries the readiness transition:
- If the PR is still **draft** (because an earlier ready gate failed or did not run), the gate runs again and may flip the PR to ready.
- If the PR is **already ready**, the resume path does nothing (idempotent no-op).
- If the gate fails again, the PR remains draft; the recovery trigger is a subsequent successful committed resume run.

That readiness transition stays **outside** stdout: **Next steps** never instruct you to mark the draft ready manually. Encountering a blocker leaves the GitHub PR in draft until content is repaired and **`jarvis1 plan --resume …`** succeeds.

### PR body updates

Each `plan: intent`, `plan: refine`, `plan: draft`, `plan: review N`, or `plan: blocker` commit triggers a PR-body rewrite that rebuilds the header and footer while preserving the narrative section verbatim.

### Merge-first rule

After the PR merges to `main`, the spec tree under **`spec/<spec-dir>`** is available to **`jarvis1 run spec/<spec-dir>/index.md`**. Do not run `jarvis1 run` against a spec tree that is still only on an unmerged `plan/*` branch; merge the authoring PR first.

## Handoff to `jarvis1 run`

Every successful `jarvis1 plan` invocation prints a next-steps block that:

- highlights the authoring PR URL;
- reminds you to merge the authoring PR before implementation;
- prints working-directory-aware commands for **`jarvis1 plan --resume spec/<spec-dir>/index.md`** (when iterating) alongside **`jarvis1 run spec/<spec-dir>/index.md`** post-merge;
- omits **`gh pr ready` / dashboard toggles**, because **`gh pr ready` already succeeded** whenever you reach this footer under normal exits.

`jarvis1 run` also warns (non-blocking) when the target spec appears to be on an
unmerged `plan/*` branch in the resolved repository.

## Cleanup

### With `commit: true` (in-repo specs)

Merged plan-branch PRs (and merged patch-branch PRs) can be reclaimed with:

```sh
jarvis1 cleanup
```

The command discovers merged git worktrees, removes them locally, then attempts
to archive committed specs by moving them from the configured plan `targetDir`
to `<targetDir>/completed/` (see authoritative rules in **[Worktrees:
Cleanup](./worktrees-and-commits.md#cleanup)**). For plan branches, cleanup
first checks `<targetDir>/<plan-name>/`, then falls back to a timestamped
`<targetDir>/YYYY-MM-DDTHH-mm-ssZ-<plan-name>/` directory.

Manual teardown without `jarvis1 cleanup`:

```sh
rm -rf .worktree/plan-<plan-name>
git branch -D plan/<plan-name>
```

### With `commit: false` (external specs)

No-commit specs in Jarvis-owned storage (`~/.jarvis/specs/…`) are **not** automatically cleaned up. They persist as local artifacts for future reference and can be re-run with `jarvis1 run` at any time.

To remove an external no-commit spec:

```sh
# Remove the spec directory manually:
rm -rf ~/.jarvis/specs/<project-key>/<spec-dir>/
```

The `jarvis1 cleanup` command does not delete Jarvis-owned external specs; it only handles git worktrees and target-repo `spec/` directories from `commit: true` runs.

## Validation rules

Each generated or rewritten spec must satisfy these rules (enforced by plan mode and inherited from patch mode):

- **`index.md` required**: Every plan-mode tree publishes **`spec/<spec-dir>/index.md`** beside `intent.md`.
- **Atomic subspecs**: Each subspec file (`[0-9]*.md`) must have an exact `## Acceptance criteria` heading (level 2, case-sensitive) with one or more checkboxes.
- **Blocker heading**: If a `## Blocker` section is appended to `intent.md`, it must use the exact heading (level 2, case-sensitive).

Plan mode validates these rules after each phase. If a validation fails, jarvis emits an error and does not commit the broken spec tree.

## Write boundary

Plan mode enforces a strict write boundary: agents may only modify files within `spec/<spec-dir>/`. If an agent attempts to modify files outside this directory (e.g., `src/`, `.github/`, `README.md`), the following happens:

1. **Detection**: After the agent returns and before any commit, jarvis runs `git status --porcelain=v1 -z` to check which files have been modified.
2. **Revert**: Any files modified outside `spec/<spec-dir>/` are reverted with `git checkout --` (the working-tree changes are discarded, but the files are not deleted).
3. **Blocker**: A `## Blocker` section is appended to `spec/<spec-dir>/intent.md` listing the offending paths and explaining the boundary violation.
4. **Commit**: The reverted state (with all out-of-bounds changes removed but in-bounds changes preserved) is committed as `plan: blocker` and the PR body is updated.
5. **Exit**: Jarvis exits with code `1`. The offending paths are printed to stderr for visibility.

This behavior applies at the draft phase, after each review pass, and before any blocker commit from the agent itself. The boundary check uses the path as reported by `git status`, so symlinks that point outside `spec/<spec-dir>/` are detected and reverted.

The intent of this enforcement is to prevent accidental or malicious modifications to files outside the spec directory, ensuring that all plan-mode work is isolated and reviewable within the spec tree.

## Operational reference

Plan-mode commit subjects:

- `plan: intent`
- `plan: refine`
- `plan: draft`
- `plan: review <N>`
- `plan: blocker`
- `plan: refine r<n>`
- `plan: review <N> r<n>`
- `plan: blocker r<n>`
