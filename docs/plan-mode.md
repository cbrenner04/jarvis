# Plan Mode

Reference for `jarvis plan [<intent-file|"inline text">]` semantics: how it creates draft specs, how the phases work, and when it stops.

## Overview

Plan mode creates a dedicated worktree and branch (`plan/<name>/` and `plan-<name>/`) to draft a new spec collaboratively with an agent. It produces:

- A seeded `spec/<name>/intent.md` capturing the user's initial request.
- A `plan: draft` commit with an agent-generated `spec/<name>/index.md` and atomic subspec files.
- Zero or more `plan: review <N>` commits (default 2) where agents refine the spec tree in place.
- A draft PR titled `plan: <name>` that aggregates progress across all phases.

The draft PR is opened after the `plan: draft` commit lands and remains in draft status until the user manually marks it ready for review. Unlike `jarvis run`, which expects specs to be complete, plan mode drafts incomplete specs — the user reviews the generated spec on the PR, edits it if needed, and merges it to `main`. After merging, the spec becomes available as a normal input to `jarvis run` for implementation work.

Plan mode is useful for:

- **Collaborative spec authoring**: agents draft specs from high-level intent, then refine them in multiple self-review passes.
- **Non-interactive automation**: `jarvis plan intent.md` or `jarvis plan "inline text"` work end-to-end without human prompts.
- **Spec validation before work**: review and edit the generated spec before implementation begins.

Plan mode does **not** handle spec implementation. After a plan-generated
spec merges to `main`, use `jarvis run spec/<name>/index.md` to implement it.

## Input modes

Plan mode accepts intent in three forms:

### File mode

```sh
jarvis plan spec/2026-05-11-v1/intent.md
```

Jarvis reads the file at the path and uses its full contents as intent.

### Inline mode

```sh
jarvis plan "Add dark mode toggle to the app settings"
```

Jarvis uses the supplied text directly as intent. Useful for quick one-liners without creating intermediate files.

### Interactive mode

```sh
jarvis plan
```

Jarvis starts with an empty seed (`# Intent` only) and runs the interview phase immediately. This mode requires at least one interview turn; `--interview-turns 0` is rejected because there is no initial intent text to plan from.

## Phases

Plan mode executes these phases in order:

### Phase 0: Interview

Jarvis starts on a temporary worktree (`.worktree/plan-tmp-<short-uuid>/`) and temporary branch (`plan/tmp-<short-uuid>`). It writes `spec/<name>/intent.md` with seeded intent text (file/inline modes) or just `# Intent` (interactive mode), then runs interview turns up to the configured budget (`--interview-turns`, default `3`).

Each turn is one agent invocation. The prompt tells the agent to use the structured `question` tool and batch one or more multiple-choice questions as needed. With `quotaFallback: "lenient"`, weak-quota fallback to the next agent runs only when **`git status --porcelain`** matches before and after that invocation (no disk mutations during the attempt); see [quota-signals.md](./quota-signals.md).

After each answered turn, jarvis validates `intent.md` changed by appending exactly one new `## Interview turn N` section and that prior content is unchanged. If the agent makes no `question` call and does not modify `intent.md` on a turn, interview ends early.

The interview also requires the agent to propose a kebab-case spec name by writing `name: <kebab-case>` in a leading frontmatter-ish block in `intent.md`. If the budget is `0` in file/inline modes, jarvis still runs one naming-only agent invocation; if no name is proposed, jarvis falls back to deterministic derivation and logs a stderr note.

Once a name is chosen (with collision suffixing if needed), jarvis renames the temporary worktree and branch to final names (`.worktree/plan-<name>/`, `plan/<name>`), then commits and pushes `plan: interview`. The temporary branch is never pushed.

**Commit shape:**
- Subject: `plan: interview`
- Body: starts with `Spec: spec/<name>/intent.md` (so the attribution renderer in `src/pr.ts` recognises it as a spec commit), followed by `Seeded from <intent path or "inline">`.
- Pushed: immediately after commit.

### Phase 1: Draft

After `plan: interview` is pushed, jarvis invokes an agent with a focused prompt (`src/modes/plan/prompts/draft.md`) that:

- Inlines `intent.md` and `docs/spec-guidance.md`.
- Asks the agent to read the target repo for context.
- Instructs the agent to produce `spec/<name>/index.md` plus one or more atomic subspecs (`00-*.md`, `01-*.md`, etc.).
- Forbids modifications to `intent.md` except for appending a `## Blocker` section.

The agent produces files under `spec/<name>/` in the worktree. Jarvis does **not** invoke the agent a second time; the call ends when the agent ends. The produced files are staged and committed as `plan: draft`.

**Placeholder collision errors:** If the user's intent or spec name accidentally contains a placeholder token (e.g., `<SPEC_GUIDANCE>`), jarvis detects this before invoking the agent and exits `3` with a fatal configuration error. This prevents silent prompt corruption.

**Commit shape:**
- Subject: `plan: draft`
- Body:
  ```
  Spec: spec/<name>/intent.md

  Drafted by <agent-attribution>.
  Subspecs: <count>
  ```
  Where `<agent-attribution>` is the agent's `attributionLabel()` (also written as the `Jarvis-Agent` git trailer) and `<count>` is the number of subspec files (files matching `spec/<name>/[0-9]*.md`, excluding `index.md` and `intent.md`). The leading `Spec: ` line lets the attribution renderer in `src/pr.ts` pick the commit up.
- Pushed: immediately after commit.

**Blocker handling:** If the agent appends a `## Blocker` section to `intent.md` during draft, the draft files are first committed as `plan: draft` (per the normal commit shape above) and then a separate `plan: blocker` commit captures the blocker; plan mode stops (see [Stop conditions](#stop-conditions)).

### Phase 2: Self-review

After `plan: draft` is pushed, jarvis runs zero or more review passes (default: 2; configurable via `--review-passes`). Each pass invokes an agent with a focused prompt (`src/modes/plan/prompts/review.md`) that:

- Inlines the current `intent.md` and all spec files.
- Inlines `docs/spec-guidance.md`.
- Asks the agent to critique the current spec tree against the intent and guidance, then rewrite files in place to address the most important issues.
- Forbids creation of new files (except for new subspec files to replace existing ones) and forbids deletion of `index.md`.
- Forbids modifications to `intent.md` except for appending a `## Blocker` section.

Each pass is a single agent invocation; the agent does not decide when to stop or how many iterations to run. After each pass, the modified files are staged and committed as `plan: review <N>` (1-indexed).

**Placeholder collision errors:** If the current spec contains a placeholder token (e.g., `<CURRENT_SPEC>`), jarvis detects this before invoking the agent and exits `3` with a fatal configuration error. This prevents silent prompt corruption.

**Commit shape (for pass 1):**
- Subject: `plan: review 1`
- Body:
  ```
  Spec: spec/<name>/intent.md

  Reviewed by <agent-attribution>.
  ```
- Pushed: immediately after commit.

**Blocker handling:** If the agent appends a `## Blocker` section to `intent.md` during a review pass, that pass's edits are committed as `plan: review <N>` and plan mode stops (see [Stop conditions](#stop-conditions)).

**`--review-passes 0`:** Skips all review passes entirely; only the draft phase and `plan: interview` commit exist. Useful for fast feedback or when self-review is not desired.

## PR body updates

The draft PR opens after `plan: draft` is pushed (via the same `updatePrBody` helper patch mode uses). Each subsequent `plan: ...` commit triggers a PR-body rewrite that:

1. Rebuilds the deterministic header (spec title and file references).
2. Rebuilds the attribution footer from `Jarvis-Agent` trailers on all plan commits on the branch (including `plan: interview`, `plan: draft`, and `plan: review N`).
3. Preserves the narrative section between `<!-- jarvis:narrative:start -->` and `<!-- jarvis:narrative:end -->` markers unchanged.

Plan mode does not write into the narrative section itself; jarvis preserves
whatever humans or agents add between the narrative markers across rewrites.

## Flags

### `--interview-turns <n>`

Controls the interview budget. Default: `3`. `0` skips interview question turns for file/inline modes but still runs a naming-only agent pass. In interactive mode, `0` is invalid and exits with: `plan: --interview-turns 0 is incompatible with interactive mode (no intent provided)`.

### `--review-passes <n>`

Number of self-review passes to run. Default: `2`. Use `--review-passes 0` to skip review entirely and stop after draft.

### `--repo <name|path|url>`

Select the target repository. Same semantics as `jarvis run --repo`. If omitted, jarvis resolves the repo from the spec path or prompts (in TTY mode) or exits with a usage error (in non-TTY mode).

### `--cwd <dir>`

(Parsed but treated as a hint; the worktree path is always created under `.worktree/plan-<name>/` in the target repo.) For consistency with `jarvis run`, this flag is accepted but has limited effect in plan mode. The spec is always produced under the target repo's `.worktree/plan-<name>/` worktree.

### `--resume <spec-path>`

Resume a previously created plan worktree and branch. This is the only
supported resume form:

```sh
jarvis plan --resume spec/<name>/index.md
```

Validation rules:

- `<spec-path>` must be an existing `spec/<name>/index.md`.
- The sibling `spec/<name>/intent.md` must exist.
- Local branch `plan/<name>` and local worktree `.worktree/plan-<name>/`
  must both exist.
- The plan worktree must have `plan/<name>` checked out.

Resume does not accept positional intent text/file and does not require
`--repo`; it operates entirely from the existing plan worktree state.

## Resuming a plan

Resume runs additional phases against an existing plan branch:

- Runs `--review-passes <n>` additional review passes (default `2`), same as
  initial invocation.
- Runs no interview turns by default.
- If `--interview-turns <n>` is passed with `n > 0`, runs interview first and
  appends new sections to `intent.md` as `## Interview turn <N>` continuing
  prior numbering.

Resume commit subjects carry an `r<n>` suffix where `<n>` is the resume
invocation number for that plan branch:

- `plan: interview r<n>` (only when resume interview turns run)
- `plan: review <N> r<n>`
- `plan: blocker r<n>`

`<N>` remains the global review-pass number across the branch, while `r<n>`
increments once per resume invocation.

## Naming

Plan mode uses an agent-proposed spec name instead of deterministic naming by default:

- During interview, the agent writes `name: <kebab-case>` in `intent.md`.
- Jarvis reads that proposal, validates/sanitizes it, and applies the uniqueness suffix loop on collisions (`-2`, `-3`, ...).
- If no valid proposal is produced in the naming step, jarvis falls back to deterministic derivation and emits a stderr note.
- Because naming happens after initial interview setup, jarvis uses a temporary worktree/branch first, then renames both to final values before the `plan: interview` push.

## Stop conditions

Plan mode stops in these cases:

### 1. All phases complete

All draft and review passes finish without encountering a blocker. Jarvis exits `0`. The draft PR (opened after `plan: draft` lands) remains in draft status. The user reviews the PR, optionally edits the spec files, marks it ready for review, and merges it to `main`. After merge, the spec is available to `jarvis run` for implementation.

### 2. Blocker encountered

If an agent appends a `## Blocker` section to `spec/<name>/intent.md` (exact heading, level 2, case-sensitive), plan mode stops immediately. The current phase's edits are staged and committed as `plan: blocker` (the last plan commit for that invocation).

**Commit shape:**
- Subject: `plan: blocker`
- Body:
  ```
  Spec: spec/<name>/intent.md

  Blocked by <reason>
  Spec files to date: <count>
  Raised by <agent-attribution>.
  ```
  Where `<reason>` is the first non-empty line of the agent's `## Blocker` body and `<count>` is the number of `[0-9]*.md` subspec files at the time the blocker was committed.
- Pushed: immediately after commit.

Jarvis then prints the blocker section to stderr and exits `1`. The draft PR
reflects the blocker for human review. The user can resolve the blocker
offline, update `spec/<name>/intent.md` manually on the branch, and re-run
`jarvis plan --resume spec/<name>/index.md` to continue, or close the PR and
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
`jarvis plan --resume spec/<name>/index.md`.

### 4. Agent quota exhausted

If the selected agent (from `modes.plan.agentOrder`) reports a quota signal, jarvis advances to the next agent in the fallback chain. While rotating, stderr lines use the same core phrases as patch mode (`quota exhausted; falling back` and `probable quota-like error (exit N); falling back`), each prefixed with `plan: <agent>: ` for grep in mixed logs. If all agents are exhausted, jarvis exits `2` and prints `plan: all agents quota-exhausted` to stderr (optionally with a phase suffix such as ` during interview`), matching patch mode's quota exit code; see [docs/quota-signals.md](./quota-signals.md) and the [Classification and fallback outcome matrix](./quota-signals.md#classification-and-fallback-outcome-matrix).

If an agent reports a `model_config` signal (the configured model is not supported by that CLI/account), jarvis exits `3` and prints `plan mode: model configuration error` plus the agent's stderr. This matches patch mode's `model_config` exit code (see `src/modes/patch/run.ts`).

### 5. Hard generic errors (excluding quota and model configuration)

**Policy (status quo):** After spawn-time classification and any lenient weak-quota upgrade (`quotaFallback: "lenient"`), a remaining classified `error` does **not** exit the inner `modes.plan.agentOrder` loop. Jarvis tries the next configured agent for the same phase invocation (interview turn, name-only pass, draft, or review). Rationale: plan mode favors completing an authoring run when one vendor CLI glitches while another may work.

**Difference from patch:** `jarvis run` stops the current iteration on the same classified `error` (typically harness exit `1`). The operator fixes the CLI or config and re-runs jarvis; only **quota** results rotate to the next agent within a single patch iteration. See [Classification and fallback outcome matrix](./quota-signals.md#classification-and-fallback-outcome-matrix).

If every agent in the order fails without `ok`, the phase returns the last failure (often the last agent's `error`).

## Agent selection

Plan mode uses `config.modes.plan.agentOrder` (not `modes.patch.agentOrder`). Config v2 requires both orders to be explicit. The quota fallback chain is the same as patch mode: if the chosen agent reports a quota signal, advance to the next; if all are exhausted, exit with code and message.

There is no fallback to patch-mode order; both must be configured.

## PR lifecycle

### Draft open

After the first `plan: draft` commit is pushed, jarvis opens a draft PR via the same `ensureDraftPr` helper patch mode uses. The PR title is `plan: <name>` (where `<name>` is the relative spec directory path). The PR body has three parts:

1. **Deterministic header**: the H1 from `spec/<name>/index.md` (or `# Plan: <name>` when the index does not yet exist), followed by a short bullet list with references to the intent and index files.
2. **Narrative section**: currently empty, preserved for future edits (bounded by `<!-- jarvis:narrative:start -->` and `<!-- jarvis:narrative:end -->` markers).
3. **Attribution footer**: rendered from `Jarvis-Agent` trailers on every plan commit on the branch. Plan-mode meta-commits (`plan: interview`, `plan: draft`, `plan: review N`, `plan: blocker`) are collapsed into a single summary line listing the count of collapsed commits and the deduped set of agents involved. Subspec commits are rendered individually, one bullet per commit, with a deduped summary line of all contributing agents.

### Draft stays draft

Unlike patch mode (which marks the PR ready for review when the spec is complete), plan mode **never** marks the PR ready. The user reviews the draft PR, optionally edits the spec files on the branch, and manually marks it ready or merges it when satisfied.

### PR body updates

Each `plan: draft`, `plan: review N`, or `plan: blocker` commit triggers a PR-body rewrite that rebuilds the header and footer while preserving the narrative section verbatim.

### Merge-first rule

After the PR merges to `main`, the spec tree under `spec/<name>/` is now available to `jarvis run` for implementation work. Do not run `jarvis run` against a spec tree that is still on a plan-mode branch; always merge the spec first.

## Handoff to `jarvis run`

Every successful `jarvis plan` invocation prints a next-steps block that:

- points to the plan PR URL;
- reminds you to merge the plan PR to `main` before implementation;
- prints the exact `jarvis run spec/<name>/index.md` command to run after
  merge.

`jarvis run` also warns (non-blocking) when the target spec appears to be on
an unmerged `plan/*` branch in the resolved repository.

## Cleanup

After a plan-mode PR is merged, the worktree and branch can be removed with:

```sh
jarvis cleanup
```

This command finds all merged worktrees (detected via `.worktree/<type>-<name>/` conventions and matching merged branches on the remote) and removes both the worktree and the local branch. The `(plan)` tag in the dry-run output (`jarvis cleanup --dry-run`) marks plan-mode worktrees.

For manual cleanup of a specific plan worktree:

```sh
rm -rf .worktree/plan-<name>
git branch -D plan-<name>
```

## Validation rules

Each generated or rewritten spec must satisfy these rules (enforced by plan mode and inherited from patch mode):

- **`index.md` required**: Every spec tree must have an `spec/<name>/index.md` file.
- **Atomic subspecs**: Each subspec file (`[0-9]*.md`) must have an exact `## Acceptance criteria` heading (level 2, case-sensitive) with one or more checkboxes.
- **Blocker heading**: If a `## Blocker` section is appended to `intent.md`, it must use the exact heading (level 2, case-sensitive).

Plan mode validates these rules after each phase. If a validation fails, jarvis emits an error and does not commit the broken spec tree.

## Write boundary

Plan mode enforces a strict write boundary: agents may only modify files within `spec/<name>/`. If an agent attempts to modify files outside this directory (e.g., `src/`, `.github/`, `README.md`), the following happens:

1. **Detection**: After the agent returns and before any commit, jarvis runs `git status --porcelain=v1 -z` to check which files have been modified.
2. **Revert**: Any files modified outside `spec/<name>/` are reverted with `git checkout --` (the working-tree changes are discarded, but the files are not deleted).
3. **Blocker**: A `## Blocker` section is appended to `spec/<name>/intent.md` listing the offending paths and explaining the boundary violation.
4. **Commit**: The reverted state (with all out-of-bounds changes removed but in-bounds changes preserved) is committed as `plan: blocker` and the PR body is updated.
5. **Exit**: Jarvis exits with code `1`. The offending paths are printed to stderr for visibility.

This behavior applies at the draft phase, after each review pass, and before any blocker commit from the agent itself. The boundary check uses the path as reported by `git status`, so symlinks that point outside `spec/<name>/` are detected and reverted.

The intent of this enforcement is to prevent accidental or malicious modifications to files outside the spec directory, ensuring that all plan-mode work is isolated and reviewable within the spec tree.

## Operational reference

Plan-mode commit subjects:

- `plan: interview`
- `plan: draft`
- `plan: review <N>`
- `plan: blocker`
- `plan: interview r<n>`
- `plan: review <N> r<n>`
- `plan: blocker r<n>`
