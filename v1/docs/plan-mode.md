# Plan Mode

Reference for `jarvis1 plan <targetDir>/ready-intents/<name>.md` semantics: how it creates draft specs, how the phases work, and when it stops.

## Overview

Plan mode consumes a **ready-intent** — a hand-authored seed produced by `jarvis1 intent` and living at `<targetDir>/ready-intents/<name>.md` — and drafts a spec tree from it. Intent authoring (raw-seed capture, refinement) happens earlier in intent mode; plan mode starts at the **draft** phase. It creates a dedicated worktree and branch (`plan/<plan-name>` and `.worktree/plan-<plan-name>/`; **no UTC prefix**) and drafts the spec collaboratively with an agent. Where specs are written depends on `modes.plan.commit` and the configured `targetDir`:

**With `commit: true` (default):** Specs are written inside the target repository under `<targetDir>/<spec-dir>/` where `<targetDir>` defaults to `spec` but may be configured per-project:
- `<targetDir>/<spec-dir>/intent.md` — a byte-for-byte copy of the ready-intent (frontmatter, sentinels, and `## Prerequisites` preserved). New runs use **`<targetDir>/YYYY-MM-DDTHH-mm-ssZ-<plan-name>/`** (`<plan-name>` is the ready-intent's `name:` after collision suffixing). Older trees may still omit the timestamp (**`<spec-dir>`** = `<plan-name>` only); both layouts stay valid for resume and `jarvis1 run`.
- A `plan: draft` commit with `<targetDir>/<spec-dir>/index.md` plus atomic subspec files (the copied `intent.md` rides in the same commit).
- Zero or more `plan: review <N>` commits (default 1) where agents refine the spec tree in place.
- A draft PR titled `plan: <plan-name>` (derived from branch identity, **not** the UTC prefix) that aggregates progress across all phases. The PR opens after the first `plan: draft` commit.

**With `commit: false`:** Specs are written in Jarvis-owned storage outside the target repository:
- The target directory must be a registered project (via `jarvis1 init` or `jarvis1 config`).
- Specs live at `~/.jarvis/specs/<project-safe-id>/<spec-dir>/` (where `<project-safe-id>` is the registered project key, origin-derived slug, or root basename).
- No git branch or worktree is created; plan mode runs in the target directory root.
- No commits, pushes, or draft PR are created.
- The generated `index.md` includes a `repo:` binding so `jarvis1 run` can resolve the target repository.
- A resolved project with effective `git: false` is forced onto this path even if `modes.plan.commit` or `projects.<key>.plan.commit` is `true`.

**With `commit: true`:** A fresh run drafts and reviews in a **single invocation**: jarvis validates the ready-intent, drafts the spec (`plan: draft`), opens or updates the branch's draft PR, runs the review passes, and — when every phase succeeds without a blocker — automatically attempts the same guarded draft→ready transition used by patch mode. If the branch is behind or diverged from its PR base, the PR stays draft. It exits **`0`**. There is no intent/refine handoff.

**Stdout Next steps:** after draft/review succeed, jarvis prints the PR URL plus exact `jarvis1 plan --resume …` and `jarvis1 run …` commands using **`<targetDir>/<spec-dir>/` paths** (e.g., `spec/…` for default repos, `v1/spec/…` for configured roots). That block deliberately **does not** ask you to toggle draft/readiness manually.

Operator/workflow decisions for PR scoping and resume rules are summarized in [v2/docs/v1-behaviors.md](../../v2/docs/v1-behaviors.md) (plan-mode bullets and flow matrix); this doc is the primary phase reference.

**With `commit: false`:** There is no PR. **Stdout Next steps:** jarvis prints the absolute path to the external spec (e.g., `~/.jarvis/specs/groceries/2026-05-18T14-30-45Z-feature/index.md`) plus the `jarvis1 run …` command using that absolute path.

Unlike `jarvis1 run`, which expects specs to be complete before PR readiness, plan mode drafts incomplete specs: you review/edit on the PR, then merge to `main`; after merging, **`jarvis1 run <targetDir>/<spec-dir>/index.md`** implements it (e.g., `jarvis1 run spec/…` or `jarvis1 run v1/spec/…` depending on your repo's configuration).

Plan mode is useful for:

- **Collaborative spec authoring**: agents draft specs from a ready-intent, then refine them in multiple self-review passes.
- **Non-interactive automation**: `jarvis1 plan <ready-intent>` works end-to-end without human prompts.
- **Spec validation before work**: review and edit the generated spec before implementation begins.

## Names and paths

- **`<plan-name>`** — The collision-suffixed kebab-case slug (from the ready-intent's `name:`) backing **`plan/<plan-name>`** and `.worktree/plan-<plan-name>/`; it **never** includes the filesystem timestamp segment.
- **`<targetDir>`** — Root directory for committed specs, configured per-project or globally (default `"spec"`). See [config.md](./config.md#targetdir-plan-mode-committrue-only) for details.
- **`<spec-dir>`** — Directory basename under **`<targetDir>/`** hosting `intent.md` / `index.md`. New runs mint **`YYYY-MM-DDTHH-mm-ssZ-<plan-name>`**; legacy trees may still flatten to **`<plan-name>`** alone. Resume + `jarvis1 run` honor both layouts.

After merge, **`jarvis1 run <targetDir>/<spec-dir>/index.md`** consumes the finalized tree (**`<spec-dir>`** keeps the UTC prefix when plan mode created one). For a default repo this is `spec/…`; for a configured root like `v1/spec/` it is `v1/spec/…`.

## Default terminal output

Successful runs omit chatty setup breadcrumbs by default (temporary slug previews, provisional worktrees). Harness / session logs still capture those details.

**With `commit: true`:** Typical milestone stderr lines look like **`plan: draft phase completed`**, **`plan: draft commit pushed`**, **`plan: draft PR #… opened`**, and review notifications such as **`plan: review pass k/n starting`** then **`plan: review pass k committed and pushed`**. Blockers, validation failures, quota/model errors, and agent stderr stay visible untouched.

After draft/review complete successfully, stdout prints the **merge/resume/run** block:

```text
Next steps:
  1. Review the draft PR: https://…
  2. Edit <targetDir>/<spec-dir>/ …
 … `jarvis1 plan --resume <targetDir>/<spec-dir>/index.md`
 … merge … `jarvis1 run <targetDir>/<spec-dir>/index.md`
```

where `<targetDir>` is the configured plan root (e.g., `spec` for default repos, `v1/spec` for this repository).

Notice there is **no** bullet telling reviewers to toggle draft/readiness — jarvis performs that readiness transition programmatically whenever every phase succeeds.

**With `commit: false`:** Milestone stderr lines for draft and review are similar (the target directory does not need to be a git repository; no "commit pushed" or "PR opened" steps since there is no GitHub integration).

Stdout includes an early `Intent:` line after the external `intent.md` is written and before any later phase can fail, then ends with the final spec handoff:

```text
Intent: ~/.jarvis/specs/groceries/2026-05-18T14-30-45Z-feature/intent.md
…
Spec written to ~/.jarvis/specs/groceries/2026-05-18T14-30-45Z-feature/index.md
Run with: jarvis1 run ~/.jarvis/specs/groceries/2026-05-18T14-30-45Z-feature/index.md
```

## Input

Fresh runs require a ready-intent path:

```sh
jarvis1 plan spec/ready-intents/my-feature.md
```

or, for a repository configured to use a non-default `targetDir`:

```sh
jarvis1 plan v1/spec/ready-intents/my-feature.md
```

The ready-intent must:

- live directly in a `ready-intents/` directory,
- carry frontmatter with a `name:` field that matches the filename (`name: my-feature` ⇔ `my-feature.md`), and
- contain a `## Prerequisites` section.

Validation runs **before** any branch, worktree, or spec directory is created; invalid input fails with operator guidance to author a ready-intent with `jarvis1 intent` first. Prerequisites are copied into the spec as prompt context but are **validated and enforced in the draft phase**, not at plan entry (entry validation only checks the `## Prerequisites` section is present). Plan mode does not require running from any specific directory — the path is resolved from the current working directory. Arbitrary markdown, `seeds/*.md`, an old generated `intent.md`, inline text, and non-existent paths are all rejected.

## Phases

Plan mode executes these phases in order.

### Prompt ownership

The editable plan prompt templates live in the shared repo-level `prompts/plan/` tree:

- `prompts/plan/draft.md`
- `prompts/plan/review.md`
- `prompts/plan/review-adversary.md`
- `prompts/plan/review-advocate.md`
- `prompts/plan/review-adjudicator.md`
- `prompts/plan/review-actuator.md`

The corresponding `v1/src/modes/plan/*.ts` files are loader/runtime logic: template loading, rewrite handling, and non-recursive rendering. Intent authoring prompts (the seed-splitting prompt) belong to intent mode (`prompts/intent/split.md`), not plan.

### Naming and setup

The ready-intent's validated `name:` becomes `<plan-name>` after the uniqueness suffix loop on collisions (`-2`, `-3`, …). Jarvis creates `.worktree/plan-<plan-name>/` and `plan/<plan-name>` directly under the final name (no temporary rename), copies the ready-intent bytes to `<targetDir>/<spec-dir>/intent.md`, and proceeds to draft.

### Phase 1: Draft

Jarvis invokes an agent with a focused prompt (`prompts/plan/draft.md`) that:

- Inlines the copied `intent.md` and `docs/spec-guidance.md`.
- Asks the agent to read the target repo for context.
- **Before producing any spec content, performs a prerequisite gate:** the agent reads existing repo files and judges whether each behavior in the intent's `## Prerequisites` section is legibly present (observable in committed code, tests, or docs; prose describing future work does not count). If every prerequisite is clearly present, the agent proceeds to normal spec drafting. If the agent cannot cleanly confirm a prerequisite from existing files, it appends a `## Blocker` section to `intent.md` naming each unconfirmed behavior, writes no `index.md` or subspecs, and plan exits non-zero with the blocker body on stderr. An empty or bareword-`none` `## Prerequisites` body skips the gate entirely.
- Instructs the agent to produce `<targetDir>/<spec-dir>/index.md` plus one or more atomic subspecs (`00-*.md`, `01-*.md`, etc.).
- Sizes each subspec as one normal patch iteration: one implementation path with focused verification. Independently implementable builder, wiring, or validation paths belong in separate subspecs; coupled changes remain together.
- Forbids modifications to `intent.md` except for appending a `## Blocker` section.

The agent produces files under `<targetDir>/<spec-dir>/` in the worktree. Jarvis does **not** invoke the agent a second time; the call ends when the agent ends. 

**Ready-intent deletion (commit: true only):** After the draft phase succeeds and the write-boundary check passes (before the `plan: draft` commit is created), jarvis deletes the source ready-intent from the worktree so the deletion is staged into the `plan: draft` commit. Deletion is skipped when the derived target is absent from the worktree base (for example, an authored-but-unmerged ready-intent) or resolves outside the worktree after path and symlink resolution; those cases still copy `intent.md` and continue. When the spec PR merges to `main`, the consumed ready-intent is removed from `<targetDir>/ready-intents/`. With `commit: false`, the source ready-intent is left untouched since the worktree is the live checkout and there is no spec PR to carry the deletion.

The produced files plus the copied `intent.md` are staged and committed as `plan: draft`, and the draft PR opens (or refreshes) on the first `plan: draft` commit.

**Prompt rendering:** Plan prompt builders use non-recursive template rendering, so placeholder-looking text in injected values (intent, spec name, etc.) is treated as literal data. For example, if the intent documents exact placeholder tokens like `<SPEC_GUIDANCE>`, those strings appear verbatim in the final prompt without escaping or recursive substitution. This allows spec-governance and prompt-documentation content to reference exact placeholder names.
Rendered prompt snapshots for this phase are reviewed from revision-keyed fixtures (`v1/test/fixtures/prompts/rendered/<id>@r<revision>...shared.txt`).

**Commit shape:**
- Subject: `plan: draft`
- Body:
  ```
  Spec: <targetDir>/<spec-dir>/intent.md

  Drafted by <agent-attribution>.
  Subspecs: <count>
  ```
  Where `<agent-attribution>` is the agent's `attributionLabel()` (also written as the `Jarvis-Agent` git trailer) and `<count>` is the number of subspec files (files matching `[0-9]*.md`, excluding `index.md` and `intent.md`). The leading `Spec:` line lets the attribution renderer in `src/pr.ts` pick the commit up.
- Pushed: immediately after commit.

**Blocker handling:** If the agent appends a `## Blocker` section to `intent.md` during draft, the draft files are first committed as `plan: draft` (per the normal commit shape above) and then a separate `plan: blocker` commit captures the blocker; plan mode stops (see [Stop conditions](#stop-conditions)).

**Index cleanup:** After `validateDraftOutput` succeeds, jarvis strips non-contract lines from `index.md`. The index contract is an H1 title, the subspec checklist items (matching `parseIndex`'s grammar), and single blank-line separators; everything else is removed, and repeated blank runs collapse to one blank line. This prevents stray agent-written metadata (e.g., `repo:` lines, prose) from persisting in the merged spec. When `commit: false`, any agent-written `repo:` line is stripped before the programmatic `repo:` binding is injected. A one-line stderr notice is emitted when ≥1 non-contract lines are removed; the cleanup no-ops when `index.md` is absent.

### Phase 2: Self-review

After `plan: draft` is pushed, jarvis runs zero or more review cycles (default: `modes.review.passes`, currently `1`; overridable via `--review-passes`). Review agents come from `modes.review.agentOrder`, falling back to `modes.plan.agentOrder`. Each cycle runs read-only adversary, advocate, and adjudicator prompts (`prompts/plan/review-*.md`). The adjudicator writes a self-contained verdict; when non-empty, jarvis persists it as `verdict-plan.md` and invokes the actuator prompt (`prompts/plan/review-actuator.md`) to apply the verdict to generated spec files. Under per-run `--agent`, the review panel and its quota rotation use the pre-override snapshot of that chain; the verdict actuator uses the override ladder — see [agents.md § Per-run `--agent` override](./agents.md#per-run---agent-override).

Reviewer role prompts:

- Inline the current `intent.md` and all spec files.
- Inline `docs/spec-guidance.md`.
- Ask the agent to critique, defend, then adjudicate the current spec tree against the intent and guidance.
- Revert any spec edits made by reviewer roles; reviewers are read-only.
- Pass role artifacts forward inside the cycle: adversary findings → advocate, advocate response → adjudicator.

The actuator prompt:

- Inlines the current `intent.md`, all generated spec files, `docs/spec-guidance.md`, and the verdict.
- Asks the agent to edit the generated spec files in place with targeted changes that satisfy the verdict.
- Forbids editing `verdict-plan.md` and forbids creation of unrelated files.
- Forbids modifications to `intent.md` except for appending a `## Blocker` section.

When post-actuator `validateReviewOutput` fails only because `intent.md` drifted from its pre-actuator snapshot (non-blocker body/frontmatter edit), Jarvis writes the snapshot bytes back, re-validates, keeps allowed subspec/`verdict-plan.md` edits, and continues the pass in the **same** review invocation — immediately after the actuator, before commit or phase return. Recovery does **not** complete when drift includes an invalid blocker composite (e.g. frontmatter edit plus `## Blocker`), when a valid blocker-only append would have passed validation, or when another validation failure coexists (e.g. missing `index.md`): the pass hard-fails with no stderr notice and no commit/phase success. For mixed failures, the helper still snapshot-reverts drifted registered immutable copies before re-validation to classify eligibility; that revert is a classification side effect, not a successful recovery. On disk after a mixed-failure hard-fail: reverted immutable copies (e.g. `intent.md`) match their pre-actuator snapshots; other validation failures (e.g. missing `index.md`) and allowed subspec edits remain. Stderr notice shape:

```
plan: actuator reverted immutable-copy overreach:
  intent.md
  verdict requirements for intent.md were not applied
```

The fixed prefix and one line per reverted path are always emitted on recovery; the fallout line appears only when the verdict text contains literal or backtick-wrapped `intent.md` (case-sensitive).

Each cycle is bounded by the configured pass count; the agents do not decide when to stop or how many cycles to run. Non-empty role and actuator artifacts are staged and committed as `plan: review: <role>` / `plan: review: actuator` (with resume suffixes when applicable). Empty verdicts skip the actuator and produce no actuator commit.

**Prompt rendering:** Like the draft phase, review prompts use non-recursive template rendering so that placeholder-looking text in the current spec (e.g., `<CURRENT_SPEC>` appearing in the snapshot) is treated as literal data without recursive substitution.
Review role and actuator variants are snapshot-tested so wording and delimiter boundaries are review-visible.

**Commit shape (for actuator):**
- Subject: `plan: review: actuator`
- Body:
  ```
  Spec: <targetDir>/<spec-dir>/intent.md

  Reviewed by <agent-attribution>.
  ```
- Pushed: immediately after commit.

**Blocker handling:** If the agent appends a `## Blocker` section to `intent.md` during a review pass, that pass's edits are committed as `plan: review <N>` and plan mode stops (see [Stop conditions](#stop-conditions)).

**`--review-passes 0`:** Skips all review passes entirely; only the draft phase exists. Useful for fast feedback or when self-review is not desired.

## Usage summaries

When at least one plan-phase agent invocation writes telemetry, Jarvis appends a **plan summary** block to stdout on exit. On successful completion, this appears after the "Next steps" section so the existing completion output stays intact.

Coverage:

- **Phases**: draft and each review pass — all agent attempts participate in the same telemetry stream.

- **Telemetry**: Rows use the configured `telemetryPath` JSONL file (same file as `jarvis1 run`), with **`mode: "plan"`** and **`plan_phase`** set to `draft` or `review`. Patch summaries ignore these rows; plan summaries ignore patch rows, so both modes can coexist in one file.

- **Labels**: The summary header reports **`phase attempts`** (count of non-`harness`, non-`run_terminal` invocation rows), not patch-style implementation iterations. Table rows use **`N attempt(s)`** per agent instead of **`N iteration(s)`**.

- **Cost**: Usage-only agent results get cost computed from the configured model id for each attempt (`modes.plan.agentOrder` for draft; review uses `modes.review.agentOrder ?? modes.plan.agentOrder`) when the price table has a matching entry — the same enrichment path as patch mode (`modes.patch.agentOrder` there). Shared terminology for token buckets, `cost_source`, and notes is documented under [Token usage and cost tracking](./run-loop.md#token-usage-and-cost-tracking) and [End-of-run summary](./run-loop.md#end-of-run-summary).

- **Quota fallback**: Quota-only attempts are excluded from aggregated totals with the same quota-excluded notes as patch mode.

- Every plan summary ends with: `Hit a harness gap? https://github.com/cbrenner04/jarvis/issues/new/choose`

No summary is printed for configuration or project-resolution failures that occur **before** any agent invocation.

## PR body updates

The draft PR opens after the first `plan: draft` commit. The PR body contains:

1. **Header**: The spec title (from `index.md` if available) plus file references.
2. **Narrative section**: A model-authored short description followed by `Decisions:` and an unordered list of notable decisions. This section is bounded by `<!-- jarvis:narrative:start -->` and `<!-- jarvis:narrative:end -->` markers for preservation.
3. **Attribution footer**: Sourced from `Jarvis-Agent` trailers on all plan commits on the branch (`plan: draft`, `plan: review N`, etc.).

Each subsequent `plan: ...` commit triggers a PR-body rewrite that rebuilds the header and footer while:

- Preserving human-written narrative inside the markers verbatim.
- Regenerating the narrative when the section is empty or still machine-owned (no human edits detected).

This contract mirrors patch mode's narrative preservation semantics: humans can edit the narrative between markers across rewrite cycles, and the markers protect those edits from being overwritten by automated regeneration.

## Configuration: `modes.plan.commit`

The `modes.plan.commit` boolean (config v2) controls where plan-mode specs are written and whether git/GitHub are involved:

- **`true` (default):** Plan specs are authored in a worktree on a branch under the target repo's `<targetDir>/<spec-dir>/` tree. Git commits (`plan: draft`, `plan: review N`) are made, a draft PR is opened after the first `plan: draft` commit, and the guarded draft→ready transition runs programmatically on success. After merge to `main`, the spec is available to `jarvis1 run`.
- **`false`:** Plan specs are written to Jarvis-owned storage outside the target directory (`~/.jarvis/specs/<project-safe-id>/<spec-dir>/`). No git branch, worktree, commits, or PR are created. Plan mode runs directly in the target directory root (which may or may not be a git repository). The generated `index.md` includes a portable `repo:` binding for later `jarvis1 run` invocations.

When `commit: false`, the spec tree must include a usable `repo:` metadata line so `jarvis1 run` can later resolve the target repository independently of the spec file's location.

When effective `git` resolves to `false` for the target project, plan mode forces `commit = false` for both fresh runs and `--resume`. This disables plan worktree/branch/push/revert behavior even if `modes.plan.commit` is `true`.

In that git-disabled path, fresh-name collision checks come only from the external spec root, and review stays external-spec-only: reviewer temp artifacts, reviewer-edit reverts, and boundary enforcement avoid repo `git status` / `git checkout` / `git clean`.

### `repo:` binding and origin detection

Plan mode writes a `repo:` line into the generated `index.md` when `commit: false` (programmatic inject only; `commit: true` strips non-contract index lines including `repo:`). GitHub HTTPS, SSH, and scp-style origins normalize to the slug form `repo: owner/repo`. Other `http:`/`https:` URLs emit `repo: <url>` (angle brackets) so bare URLs do not trip `lint:md`. When the target project has a configured `origin` URL, that value drives inject after normalization. When `origin` is not configured but the project root is a git checkout with an `origin` remote, plan mode automatically detects that remote via `git remote get-url origin` and emits the MD034-safe `repo:` form. This detection is read-only and does not persist the origin back to `~/.jarvis/config.json`. On any detection failure (non-git directory, no `origin` remote, missing `git` binary, etc.), plan mode falls back silently to the registered project key, which remains resolver-safe for `jarvis1 run`.

## Flags

### `--review-passes <n>`

Number of self-review passes to run. Default: `1`. Use `--review-passes 0` to skip review entirely and stop after draft.

### `--repo <name|path|url>`

Select the target repository. Same semantics as `jarvis1 run --repo`. If omitted, jarvis resolves the repo from the ready-intent path or prompts (in TTY mode) or exits with a usage error (in non-TTY mode).

### `--cwd <dir>`

(Parsed but treated as a hint; the finalized worktree always lives under `.worktree/plan-<plan-name>/` in the target repo.) For consistency with `jarvis1 run`, this flag is accepted but has limited effect in plan mode.

### `--target-dir <dir>`

Override the configured plan root for this invocation (validated: no `..` segments). Determines where the spec tree is written and which `ready-intents/` parent is expected.

### `--resume <spec-path>`

Resume a previously created post-draft plan worktree and branch to run additional review passes:

```sh
jarvis1 plan --resume spec/2026-05-17T22-14-03Z-my-plan/index.md
# legacy layouts still accepted, e.g. spec/my-plan/index.md
```

Validation rules:

- `<spec-path>` must point at `<targetDir>/<spec-dir>/index.md` on disk.
- The sibling `<targetDir>/<spec-dir>/intent.md` must exist.
- If `.worktree/plan-<plan-name>/` is missing, jarvis tries to recreate it from local `plan/<plan-name>` or `origin/plan/<plan-name>` and logs `plan: recreated worktree at <path> from <local|origin>`.
- If neither local nor remote plan branch exists, resume still fails with the same missing-worktree error.
- The plan worktree must have **`plan/<plan-name>`** checked out.
- `origin/plan/<plan-name>` must exist; local-only plan branches still fail the preserved origin requirement after any worktree recreation.

Resume does not accept positional intent text and does not require `--repo`; it operates entirely from the existing plan worktree state.

For external-spec resumes (`commit: false`, including effective `git: false`), jarvis resumes review directly from `~/.jarvis/specs/<project-safe-id>/<spec-dir>/index.md` with no plan worktree/branch recreation.

> **Removed:** `--resume-draft` and `--refine-turns`. Intent authoring and refinement moved to `jarvis1 intent`; plan starts at draft. `--resume-draft` is still parsed but exits with guidance to use `jarvis1 plan <ready-intent>` (fresh) or `jarvis1 plan --resume <index.md>` (post-draft review).

### `--recover <relative-subspec> <index.md>`

Recover one oversized timed-out task into a separate spec-only draft PR:

```sh
jarvis1 plan --recover ./00-task.md v1/spec/2026-07-11T00-00-00Z-task/index.md
```

The target must be one unchecked link in that index and have one terminal patch iteration-timeout record. Recovery refuses pending checkpoint work; resume or abandon that patch work first. It does not alter ordinary patch runs or `--resume`. See [v2/docs/v1-behaviors.md](../../v2/docs/v1-behaviors.md) for the lifecycle and evidence rules.

## Resuming a plan

Resume runs additional **review passes** against an existing plan branch:

- Runs `--review-passes <n>` additional review passes (default `1`), same as the initial invocation.
- Runs no intent or refine phases (those no longer exist in plan).

Resume commit subjects carry an `r<n>` suffix where `<n>` is the resume invocation number for that plan branch:

- `plan: review <N> r<n>`
- `plan: blocker r<n>`

`<N>` remains the global review-pass number across the branch, while `r<n>` increments once per resume invocation.

## Naming

Plan mode takes the spec name from the ready-intent rather than deriving it:

- The ready-intent's frontmatter `name: <kebab-case>` (validated at entry to match the filename) becomes the base `<plan-name>`.
- **Fresh `commit: true` re-runs with disposable worktrees (self-heal):** When a surviving local `plan/<plan-name>` branch has no commits beyond its merge-base with the current HEAD, no `origin/plan/<plan-name>` remote tracking ref, and no committed `<targetDir>/<timestamp>-<plan-name>` spec dir exists, the run reuses the same `<plan-name>` by tearing down the stale worktree/branch and recreating fresh from the base branch. No manual cleanup is required; the re-run is self-healing.
- **Collision bumping:** When same-name state is non-disposable (a committed spec dir exists, the remote branch exists, or the branch carries plan commits beyond the merge-base), jarvis applies the uniqueness suffix loop on collisions (`-2`, `-3`, …) against the final name. The worktree/branch are created under the final name directly; there is no temporary-name rename.
- A disposable worktree is one with local-only scratch state that can be safely discarded and recreated. A dirty/uncommitted worktree is treated as disposable scratch.

## Stop conditions

Plan mode stops in these cases:

### 1. All phases complete

All draft and review passes finish without encountering a blocker. Jarvis exits **`0`** and attempts the guarded draft→ready transition alongside the customary stdout **Next steps** block (**which omits redundant manual ready-flip instructions**). Behind/diverged branches stay draft; base-resolution/fetch failures soft-fail open to proceed. Humans still review/modify GitHub/Git content and merge once satisfied using `jarvis1 run <targetDir>/<spec-dir>/index.md` afterward.

### 2. Blocker encountered

If an agent appends a `## Blocker` section to `<targetDir>/<spec-dir>/intent.md` (exact heading, level 2, case-sensitive), plan mode stops immediately. The current phase's edits are staged and committed as `plan: blocker` (the last plan commit for that invocation).

**Commit shape:**
- Subject: `plan: blocker`
- Body:
  ```
  Spec: <targetDir>/<spec-dir>/intent.md

  Blocked by <reason>
  Spec files to date: <count>
  Raised by <agent-attribution>.
  ```
  Where `<reason>` is the first non-empty line of the agent's `## Blocker` body and `<count>` is the number of `[0-9]*.md` subspec files at the time the blocker was committed.
- Pushed: immediately after commit.

Jarvis then prints the blocker section to stderr and exits `1`. The draft PR reflects the blocker for human review. The user can resolve the blocker offline, update `<targetDir>/<spec-dir>/intent.md` manually on the branch, and re-run `jarvis1 plan --resume <targetDir>/<spec-dir>/index.md` to continue, or close the PR and start over.

### 3. Ctrl-C

User interrupts with Ctrl-C (SIGINT). Jarvis records the signal and, at the next interrupt-checkpoint (after the current agent invocation returns and *before* any commit/push for that pass), exits `130` (standard POSIX exit code for SIGINT) leaving the worktree, branch, and PR as they were on entry to that pass. A second Ctrl-C while an agent is still running falls through to Node's default handler and terminates the process immediately, which may leave a partially-written file in the worktree but never an unintended commit. The user can return to the worktree and continue manually or with `jarvis1 plan --resume <targetDir>/<spec-dir>/index.md`.

### 4. Agent quota exhausted

The draft phase uses `modes.plan.agentOrder`. Review passes use the shared review agent chain (`modes.review.agentOrder`, falling back to `modes.plan.agentOrder`). Each review pass starts a fresh agent chain (quota exhaustion on pass 1 does not remove agents from pass 2). When a selected agent reports a quota signal, jarvis advances to the next agent in that pass's chain. While rotating during draft, stderr lines use the same core phrases as patch mode (`quota exhausted; falling back` and `probable quota-like error (exit N); falling back`), each prefixed with `plan: <agent>:` for grep in mixed logs. Review quota rotation uses the same phrases with the `plan: <agent>:` prefix via `emitPlanAgentQuotaFallback`. Under `quotaFallback: "lenient"`, review also upgrades weak-quota spawn **`error`** results when git porcelain is unchanged across the invocation. If all agents are exhausted in a pass, jarvis exits `2` and prints `plan: all agents quota-exhausted` to stderr (optionally with a phase suffix), matching patch mode's quota exit code; see [docs/quota-signals.md](./quota-signals.md) and the [Classification and fallback outcome matrix](./quota-signals.md#classification-and-fallback-outcome-matrix).

If an agent reports a `model_config` signal during **draft** or **intent-split**, jarvis advances to the next agent in `modes.plan.agentOrder` when one remains. While rotating, stderr lines use `plan: <agent>: model configuration error; falling back` (draft) or `intent: <agent>: model configuration error; falling back` (intent-split), optionally followed by that agent's stderr. When every agent in the order returns `model_config` without `ok`, jarvis exits `3` and prints `plan: model configuration error` or `intent: model configuration error` plus the last agent's stderr. Pre-invocation `model_config` (empty `agentOrder`, prompt-build failure) is still terminal without cascade.

**Review (intentional divergence):** If an agent reports `model_config` during a review pass, jarvis exits `3` and prints `plan: model configuration error` plus the agent's stderr — review does not cascade. This matches patch mode's `model_config` exit code (see `src/modes/patch/run.ts`).

### 5. Hard generic errors (excluding quota and model configuration)

**Policy:** After spawn-time classification and any lenient weak-quota upgrade (`quotaFallback: "lenient"`), a remaining classified `error` does **not** exit the inner `modes.plan.agentOrder` loop for draft. Jarvis tries the next configured agent for the same phase invocation.

**Review (intentional divergence):** The shared review runner matches patch review: **quota** (including lenient weak-quota upgrades) rotates to the next review agent within the pass; **`model_config`** is fatal (exit `3`); other hard **`error`** results stop that pass immediately without trying siblings. Rationale: review passes are bounded critique loops; a hard CLI failure is treated like patch review rather than retried across the full plan order.

**Difference from patch implementation:** `jarvis1 run` stops the current **implementation** iteration on the same classified `error` (typically harness exit `1`). Only **quota** rotates within a single patch iteration. Review (plan + patch) shares the runner rules above. See [Classification and fallback outcome matrix](./quota-signals.md#classification-and-fallback-outcome-matrix).

If every agent in the order fails without `ok`, the phase returns the last failure (often the last agent's `error`).

## Agent selection

Plan mode uses `config.modes.plan.agentOrder` for draft (not `modes.patch.agentOrder`). Review uses `modes.review.agentOrder ?? modes.plan.agentOrder`. Config v2 requires patch and plan orders to be explicit. The quota fallback chain is the same as patch mode: if the chosen agent reports a quota signal, advance to the next in that phase's chain; if all are exhausted, exit with code and message.

**Per-run `--agent`:** actuators use the flag ladder; review panel keeps the pre-override snapshot. `--resume` + `--agent` applies override to verdict-actuator only. See [agents.md](./agents.md#per-run---agent-override).

There is no fallback to patch-mode order; both must be configured.

## PR lifecycle

### Draft open

On fresh `commit: true` runs, the first `plan: draft` commit triggers the `ensureDraftPr` helper that patch mode uses to open or update the branch's **open** draft PR. `ensureDraftPr` scopes to the current branch's open PR only — closed or unrelated PRs are not reused. GitHub renders the draft bit until **`gh pr ready` succeeds**. The PR title stays **`plan: <plan-name>`** — i.e., the slug shared with the branch (**not** the leading UTC segment of **`spec/`** paths when present). PR body internals:

1. **Deterministic header**: the H1 from `<targetDir>/<spec-dir>/index.md` (or `# Plan: <plan-name>` when the index does not yet exist), followed by bullets that cite **`<targetDir>/<spec-dir>/intent.md`** and **`<targetDir>/<spec-dir>/index.md`**.
2. **Narrative section**: a model-authored short description followed by `Decisions:` and an unordered list of notable decisions (bounded by `<!-- jarvis:narrative:start -->` and `<!-- jarvis:narrative:end -->` markers). Humans can edit the narrative between the markers; edits are preserved verbatim during PR body rewrites.
3. **Attribution footer**: rendered from `Jarvis-Agent` trailers on every plan commit on the branch. Plan-mode meta-commits (`plan: draft`, `plan: review N`, `plan: blocker`) are collapsed into a single summary line listing the count of collapsed commits and the deduped set of agents involved. Subspec commits are rendered individually, one bullet per commit, with a deduped summary line of all contributing agents.

### Auto-mark ready on success

Like patch mode, plan mode runs the built-in `full` gate automatically once every scripted phase succeeds (no blocker): built-in `bun run fix` (committing any dirty output first), then built-in `bun run ready`, then post-verification commit-if-dirty when verification leaves non-empty porcelain. Built-in `ready` is strict verification-only; see [`v2/docs/v1-behaviors.md`](../../v2/docs/v1-behaviors.md) for the authoritative built-in ready/fix split and step order. Unlike patch mode, committed plan-mode readiness does not thread the per-project `readyCommand` override today; it always runs the built-ins.

**Pre-ready markdown repair (`commit: true` only):** Immediately before the ready gate, jarvis runs `repairPlanSpecMarkdown` on the active spec directory: `index.md`, `intent.md`, and numbered `NN-*.md` subspecs (excluding `verdict-*.md`). Each file gets the same MD018 issue-reference guard intent emit uses, then harness-pinned markdownlint `--fix` against `.markdownlint-cli2.jsonc` with cwd anchored to the harness repo. Residual non-autofixable violations do not fail plan; `lint:md` in the ready gate remains authoritative. After autofix, non-contract `index.md` lines are stripped again. Spawn failure or a missing markdownlint binary warns to stderr and continues. Successful fresh runs and successful `--resume` runs share this repair-then-ready path.

**Readiness transition behavior:**
- If the branch's open PR is **draft**, plan first resolves the PR's actual base, fetches `origin/<base>`, and confirms `HEAD` contains that fetched base tip. If the branch is behind or diverged from base, jarvis emits a stderr message, skips the ready flip, and leaves the PR draft. If the base check cannot resolve or fetch, it soft-fails open and continues. After a passing base-current check, the gate runs built-in `bun run fix` (committing any dirty output before verification), then built-in `bun run ready`, then post-verification commit-if-dirty when applicable. On success, `gh pr ready` flips the PR to ready. This call site is not wired to `readyCommand`. On gate failure, the PR remains draft.
- If the branch's open PR is **already ready**, both the gate and GitHub transition are skipped; the PR remains ready and emits no warning.
- If **no open PR exists**, the readiness helper is a silent no-op.

**Recovery on resume:** A later successful `jarvis1 plan --resume …` invocation retries the readiness transition:
- If the PR is still **draft** (because an earlier ready gate failed or did not run), the gate runs again after `repairPlanSpecMarkdown` and may flip the PR to ready.
- If the PR is **already ready**, the resume path does nothing (idempotent no-op).
- If the gate fails again, the PR remains draft; the recovery trigger is a subsequent successful committed resume run.

That readiness transition stays **outside** stdout: **Next steps** never instruct you to mark the draft ready manually. Encountering a blocker leaves the GitHub PR in draft until content is repaired and **`jarvis1 plan --resume …`** succeeds.

### PR body updates

Each `plan: draft`, `plan: review N`, or `plan: blocker` commit triggers a PR-body rewrite that rebuilds the header and footer while preserving the narrative section verbatim.

### Merge-first rule

After the PR merges to `main`, the spec tree under **`<targetDir>/<spec-dir>`** is available to **`jarvis1 run <targetDir>/<spec-dir>/index.md`**. Do not run `jarvis1 run` against a spec tree that is still only on an unmerged `plan/*` branch; merge the authoring PR first.

## Handoff to `jarvis1 run`

Every successful `jarvis1 plan` invocation prints a next-steps block that:

- highlights the authoring PR URL;
- reminds you to merge the authoring PR before implementation;
- prints working-directory-aware commands for **`jarvis1 plan --resume <targetDir>/<spec-dir>/index.md`** (when iterating) alongside **`jarvis1 run <targetDir>/<spec-dir>/index.md`** post-merge;
- omits **`gh pr ready` / dashboard toggles**, because **`gh pr ready` already succeeded** whenever you reach this footer under normal exits.

`jarvis1 run` also warns (non-blocking) when the target spec appears to be on an unmerged `plan/*` branch in the resolved repository.

## Cleanup

### With `commit: true` (in-repo specs)

**On pre-commit failure:** When a `commit: true` plan fails **before** the first `plan: draft` commit (draft agent errors, validation failures, draft-phase exceptions, or draft-commit failures), jarvis automatically cleans up the associated worktree and branch, leaving no `.worktree/plan-<plan-name>/` directory or `plan/<plan-name>` branch. Cleanup is local-only; a surviving remote `origin/plan/<plan-name>` branch is expected when the failure occurs after push but before the draft commit succeeds. Resumable failure states (boundary blockers and draft/review-phase blockers where commits exist) preserve their worktrees and branches for `--resume`.

**On success:** Merged plan-branch PRs (and merged patch-branch PRs) can be reclaimed with:

```sh
jarvis1 cleanup
```

The command discovers merged git worktrees, removes them locally, then archives the linked spec from its home (see authoritative rules in **[Worktrees: Cleanup](./worktrees-and-commits.md#cleanup)**). For `commit: true`, cleanup moves the in-repo spec from its resolved home (`<targetDir>`, `v1/spec`, or `v2/spec`) to that home's `completed/` dir; for plan branches it first checks `<home>/<plan-name>/`, then falls back to a timestamped `<home>/YYYY-MM-DDTHH-mm-ssZ-<plan-name>/` dir. For `commit: false`, cleanup moves `~/.jarvis/specs/<project-safe-id>/<name>/` to `~/.jarvis/specs/<project-safe-id>/completed/<name>/` and prunes `ready-intents/<branch-slug>.md` when present, with no git commit.

Manual teardown (when needed outside the automatic pre-commit failure cleanup or the `jarvis1 cleanup` command):

```sh
rm -rf .worktree/plan-<plan-name>
git branch -D plan/<plan-name>
```

### With `commit: false` (external specs)

No-commit specs in Jarvis-owned storage (`~/.jarvis/specs/…`) persist until the associated merged worktree is cleaned up or the operator removes them manually. They can be re-run with `jarvis1 run` at any time before archival.

**On success:** After draft, configured review, and durable spec writes succeed, plan consumes its source ready-intent: `commit: true` stages the safe deletion in `plan: draft`; `commit: false` deletes the safe live-checkout entry. The spec tree and its `index.md` remain until `jarvis1 cleanup` archives them into `~/.jarvis/specs/<project-safe-id>/completed/`. Cleanup's best-effort pruning of an old `ready-intents/<branch-slug>.md` remains an idempotent fallback.

**On failure:** When `commit: false` plan phases fail (draft, review, validation, quota, model configuration, boundary violation, filesystem publication, or interrupt), both the ready-intent and the named external spec directory with its `intent.md` are preserved for retry; failure output prints the preserved directory path (e.g., `Spec preserved at ~/.jarvis/specs/…`) adjacent to the error. The only exception is if the `intent.md` write itself fails before the `Intent:` line is printed — in that case, the abandoned pre-`intent.md` spec directory is removed and no breadcrumb is emitted (the operator did not yet receive an `Intent:` path, so there is no external artifact to preserve).

To remove an external no-commit spec:

```sh
# Remove the spec directory manually:
rm -rf ~/.jarvis/specs/<project-key>/<spec-dir>/
```

`jarvis1 cleanup` archives Jarvis-owned external specs for merged `commit:false` worktrees, but manual removal is still available when you want to discard an unmerged or otherwise orphaned external spec.

## External spec directory write access

With `commit: false`, the draft, review, and verdict-actuator phases run with write access to the external spec directory (under `~/.jarvis/specs/…`), allowing the agent to write `index.md` and subspecs and to append `## Blocker` sections to the external `intent.md`. Only Claude and Codex receive this access as `--add-dir` flags; Cursor and Opencode never receive the directory. Write effectiveness varies by agent: Claude and Codex honor the grant; Cursor and Opencode cannot write external files (inherited limitation of their underlying permission models).

With `commit: true`, the spec directory lives inside the worktree (under `<targetDir>/`), so no external write grant is needed.

## Validation rules

Each generated or rewritten spec must satisfy these rules (enforced by plan mode and inherited from patch mode):

- **`index.md` required**: Every plan-mode tree publishes **`<targetDir>/<spec-dir>/index.md`** beside `intent.md`.
- **Atomic subspecs**: Each subspec file (`[0-9]*.md`) must have an exact `## Acceptance criteria` heading (level 2, case-sensitive) with one or more checkboxes.
- **Blocker heading**: If a `## Blocker` section is appended to `intent.md`, it must use the exact heading (level 2, case-sensitive).

Plan mode validates these rules after each phase. If a validation fails, jarvis emits an error and does not commit the broken spec tree.

### Draft structural validation

Before the `plan: draft` commit is created, jarvis performs structural validation on each generated subspec file (`NN-*.md`). These checks are **non-blocking in review passes** (they run only at draft time; resume `plan: review N rM` passes do not re-validate).

**Structural checks per generated subspec:**

- **Heading exactness (fail)**: A near-miss acceptance or blocker heading (e.g. `### Acceptance criteria`, `## acceptance criteria`, `## Blocker` variants) blocks the draft commit. The parser already detects these and the draft gate promotes them to hard failures.
- **Duplicate canonical sections (fail)**: A subspec with duplicate `## Acceptance criteria` or duplicate `## Blocker` headings blocks the draft commit. The parser takes the first occurrence, so a second block's criteria are invisible to patch-mode ticking — a correctness hazard.
- **Missing/empty acceptance section (fail)**: A subspec with no parseable acceptance criteria under an exact `## Acceptance criteria` heading blocks the draft commit. An unparseable subspec never completes at run time.
- **Structural ACs (warn, non-blocking)**: An acceptance criterion whose predicate is a location/existence claim about code structure (e.g. "X lives in a dedicated module with unit tests") produces a non-blocking warning on stderr. Behavioral ACs naming a symbol as the subject of a behavioral assertion (e.g. "`validateDraftOutput` returns invalid when …") produce no warning. The draft still commits when structural ACs are detected.
- **Behavioral/preservation AC anchor grounding (warn, non-blocking)**: An acceptance criterion containing a preservation/continuation trigger verb (`preserved`, `unchanged`, `stays`, `remains`, `stops`, `continues`) but lacking a test or source anchor produces a non-blocking warning on stderr. An anchor is a path-like reference — a `*.test.ts` filename or a backtick span containing a path separator or source-file extension (e.g. `` `v1/src/commands/plan.ts` ``). A plain backtick span without path shape does not count as an anchor. The draft still commits when anchor warnings are detected. The operator reviews on the draft PR and implementation-side patch rules provide the hard backstop.
- **Unsatisfiable acceptance criteria (fail)**: An acceptance criterion that is not marked human-only but asserts something only verifiable via GitHub/network resources (PR body/title, CI status, review state, merge readiness, etc.) blocks the draft commit. These assertions cannot be verified from the implement worktree and would strand every implementation run at `blocked`. The criterion must either be marked human-only with `(Manual)`, `visual inspection only`, or `no automated guard`, or rewritten as a satisfiable worktree-verifiable outcome. Human-only markers are exempt from this check.

The blocker short-circuit still runs first: if `intent.md` carries a genuine `## Blocker`, no subspecs are expected and structural checks do not run.

## Write boundary

Plan mode enforces a strict write boundary: agents may only modify files within `<targetDir>/<spec-dir>/`. If an agent attempts to modify files outside this directory (e.g., `src/`, `.github/`, `README.md`), the following happens:

1. **Detection**: After the agent returns and before any commit, jarvis runs `git status --porcelain=v1 -z` to check which files have been modified.
2. **Revert**: Any files modified outside `<targetDir>/<spec-dir>/` are reverted with `git checkout --` (the working-tree changes are discarded, but the files are not deleted).
3. **Blocker**: A `## Blocker` section is appended to `<targetDir>/<spec-dir>/intent.md` listing the offending paths and explaining the boundary violation.
4. **Commit**: The reverted state (with all out-of-bounds changes removed but in-bounds changes preserved) is committed as `plan: blocker` and the PR body is updated.
5. **Exit**: Jarvis exits with code `1`. The offending paths are printed to stderr for visibility.

This behavior applies at the draft phase and after each review pass. The boundary check uses the path as reported by `git status`, so symlinks that point outside `<targetDir>/<spec-dir>/` are detected and reverted.

For `commit: false`, jarvis no longer inspects the external spec-root (`~/.jarvis/specs/<project-safe-id>/`); concurrent no-commit plans can now coexist without triggering spurious boundary violations. A stray write to external storage by one plan is no longer detected; this is an accepted coverage loss since the blast radius is Jarvis-owned scratch storage, not the target repository. When effective `git` is `true`, jarvis still checks the target checkout for stray `spec/`-prefixed writes via `assertTargetRepoPlanBoundary`, which detects only files starting with `spec/` in the live checkout and does not cover external-storage escapes. When effective `git` is `false`, that target-repo boundary check is skipped entirely; there is no `git checkout --`, push, or plan worktree cleanup path in draft or review.

The intent of this enforcement is to prevent accidental or malicious modifications to files outside the spec directory, ensuring that all plan-mode work is isolated and reviewable within the spec tree.

## Operational reference

Plan-mode commit subjects:

- `plan: draft`
- `plan: review <N>`
- `plan: blocker`
- `plan: review <N> r<n>`
- `plan: blocker r<n>`
