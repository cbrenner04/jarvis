# v1 behavior catalog for v2 parity review

This document inventories user-observable v1 behavior so v2 can explicitly preserve, change, or drop each item.

## Overview and scope

- This catalog describes behavior as shipped today under `v1/`, with v1 invoked via `jarvis` in CLI usage and help text. Sources: `v1/src/cli.ts`
- The planned `jarvis1` rename is still pending, so this file intentionally records current `jarvis` behavior as the migration baseline for v2 review. Sources: `v1/src/cli.ts`, `spec/2026-05-22T04-09-01Z-v1-behavior-catalog/00-skeleton-commands-and-project-resolution.md`
- Source files under `v1/src/` are treated as authority for behavior; docs are used to cross-check operator workflow expectations and terminology. Sources: `v1/src/cli.ts`, `v1/docs/run-loop.md`, `v1/docs/spec-guidance.md`
- Behavior entries in this catalog stay as short bullets ending with `Sources:` citations; `[uncertain]` is reserved for cases where source evidence cannot support a stronger claim. Sources: `spec/2026-05-22T04-09-01Z-v1-behavior-catalog/00-skeleton-commands-and-project-resolution.md`

## Commands and modes

### Command surface

- The shipped top-level subcommands are `run`, `init`, `config`, `log-server`, `cleanup`, `triage`, `review-feedback`, `plan`, `prices`, and `help` (including `-h`/`--help` aliases to help output). Sources: `v1/src/cli.ts`
- Unknown subcommands exit non-zero and print usage, while parse-time argument errors also print usage with a command-specific error prefix. Sources: `v1/src/cli.ts`
- `review-feedback` requires a non-empty `<worktree-name>` and exits with usage when omitted, while `triage` accepts an optional worktree argument and otherwise runs a no-arg listing mode. Sources: `v1/src/cli.ts`, `v1/src/commands/triage.ts`
- `prices` is a two-operation command surface (`show` and `edit`) rather than one flat action, and missing/unknown prices subcommands print command-specific usage. Sources: `v1/src/commands/prices.ts`, `v1/src/commands/prices-show.ts`, `v1/src/commands/prices-edit.ts`
- `cleanup` exposes a `--dry-run` mode and requires execution from inside a registered project or it exits with a targeted registration error. Sources: `v1/src/cli.ts`, `v1/src/commands/cleanup.ts`

### Patch-mode run workflow

- `jarvis run` accepts `--max-iterations`, `--repo`, and `--cwd` around a required `<spec-path>`, then forwards those into run-mode options after validating numeric bounds for max iterations. Sources: `v1/src/cli.ts`, `v1/src/modes/patch/run.ts`
- Default implementation runs are index-routed: operators are expected to run against an `index.md` tree where one unchecked linked subspec is selected per agent iteration. Sources: `v1/docs/spec-guidance.md`, `v1/docs/run-loop.md`
- Non-index spec runs prompt for explicit operator action instead of silently proceeding as a normal index loop. Sources: `v1/docs/spec-guidance.md`, `v1/docs/run-loop.md`

### Plan mode

- `jarvis plan` is a distinct command path from `run`, receives its own argument parser/handler, and is reserved here for dedicated behavior expansion in subspec 03. Sources: `v1/src/cli.ts`, `v1/src/commands/plan.ts`

## Spec authoring and implementation workflows

- New implementation specs are expected to be authored as index-routed trees (`index.md` + numbered subspec files) with checklist links from index into atomic subspec documents. Sources: `v1/docs/spec-guidance.md`
- The documented workflow requires spec-first sequencing: create a spec PR, merge spec files to `main`, and only then start implementation runs against that merged spec. Sources: `v1/docs/spec-guidance.md`
- `jarvis plan` can generate spec trees, but generated specs follow the same merge-first rule before `jarvis run` implementation work begins. Sources: `v1/docs/spec-guidance.md`, `v1/docs/workflows.md`
- External plan output (`modes.plan.commit: false`) produces Jarvis-owned spec trees outside the repo with a required `repo:` binding so later `jarvis run` invocations can resolve the target checkout. Sources: `v1/docs/spec-guidance.md`, `v1/docs/config.md`

## Config and project resolution

### Config storage and bootstrap

- Jarvis stores state under `~/.jarvis/` with `config.json`, and configuration is auto-bootstrapped on first run rather than requiring manual initialization. Sources: `v1/src/config.ts`, `v1/docs/config.md`
- The config defaults to schema version 2 with mode-specific agent order blocks (`modes.patch.agentOrder` and `modes.plan.agentOrder`) and project registry storage under `projects`. Sources: `v1/src/config.ts`, `v1/docs/config.md`
- Invalid config structure is rejected with file-specific validation errors instead of partial best-effort reads. Sources: `v1/src/config.ts`
- `jarvis init` only registers repos under `~/Work` by deriving the project key from the path relative to that root, and it records `origin` only when `git remote get-url origin` yields a non-empty value. Sources: `v1/src/commands/init.ts`, `v1/src/config.ts`

### Repository resolution order and matching

- Target-repo resolution order is `--repo` first, then spec `repo:` value, then spec-path-inside-registered-project, then ad-hoc parent walk for a `.git` checkout root, then unresolved prompt/error signaling. Sources: `v1/src/resolve-project.ts`, `v1/src/repo.ts`, `v1/docs/run-loop.md`
- For both `--repo` and non-absolute `repo:` values, matching first checks exact registered project key and then loose URL/slug equivalence via normalized `host/owner/repo` comparison. Sources: `v1/src/resolve-project.ts`, `v1/src/repo-url.ts`
- Legacy absolute-path `repo:` values are honored only as exact matches to a registered project root; non-matching absolute paths fall through to location-based resolution. Sources: `v1/src/resolve-project.ts`, `v1/docs/spec-guidance.md`, `v1/docs/run-loop.md`
- URL normalization intentionally lowercases host/owner/repo, strips protocol/user/trailing `.git`, interprets bare `owner/repo` as GitHub, and drops extra URL path segments when comparing loose matches. Sources: `v1/src/repo-url.ts`

### Ambiguity handling and operator prompts

- Multiple registered matches for `--repo` or spec `repo:` produce an explicit ambiguous result with candidate set rather than picking one silently. Sources: `v1/src/resolve-project.ts`
- In interactive mode, disambiguation prompts let operators choose by 1-based index or exact project key, with `q`/blank treated as cancellation. Sources: `v1/src/disambiguation-prompt.ts`
- In non-TTY mode, disambiguation does not prompt and instead emits candidates plus a rerun hint using `--repo <name>`. Sources: `v1/src/disambiguation-prompt.ts`

## Agent adapters, model selection, and quota fallback

### Roster and default order

- v1 recognizes exactly five adapter names (`claude`, `codex`, `cursor`, `opencode`, `aider`) and `createAgent()` instantiates the matching adapter class directly from that name/model pair. Sources: `v1/src/agents/types.ts`, `v1/src/agents/factory.ts`
- Default `modes.patch.agentOrder` and `modes.plan.agentOrder` include only three entries in this order: `claude` (`haiku`), `codex` (`gpt-5.3-codex`), then `cursor` (`Composer 2`); `opencode` and `aider` are supported but opt-in via config edits. Sources: `v1/src/config.ts`, `v1/docs/agents.md`
- `jarvis run` executes agents in configured patch order and advances only when an agent result is classified as quota-related; if the active agent returns a non-quota hard error, the iteration stops instead of trying later agents. Sources: `v1/src/modes/patch/run.ts`, `v1/src/agents/quota.ts`

### Adapter-specific behavior

- `claude` runs `claude -p --permission-mode acceptEdits --output-format json`, pipes the prompt on stdin, forwards `--add-dir` entries, and parses JSON response fields into displayed text, usage, and cost when present. Sources: `v1/src/agents/claude.ts`, `v1/docs/agents.md`
- `codex` runs `codex exec --color never --sandbox workspace-write -c approval_policy="on-request"` with stdin prompt piping, appends a per-invocation marker to the prompt, and derives usage by correlating changed `~/.codex/sessions/*.jsonl` files; ambiguous or missing correlation is reported as unavailable instead of guessed. Sources: `v1/src/agents/codex.ts`, `v1/src/agents/codex-session.ts`, `v1/docs/agents.md`
- `cursor` runs `cursor agent -p --output-format text --force --workspace <cwd> <prompt>`, and successful runs estimate token usage from prompt+stdout rather than CLI-reported counters. Sources: `v1/src/agents/cursor.ts`, `v1/src/agents/cursor-tokens.ts`, `v1/docs/agents.md`
- `opencode` runs `opencode run --dir <cwd> --model <provider/model> --format json <prompt>`, parses JSONL event output, uses summed `step_finish` token/cost fields when present, and falls back to estimator warnings when no clean `step_finish` data exists. Sources: `v1/src/agents/opencode.ts`, `v1/src/agents/token-estimation.ts`, `v1/docs/agents.md`
- `aider` runs with non-interactive flags including `--yes-always`, `--no-auto-commits`, `--no-git`, and `--no-show-model-warnings`, sets `BROWSER=false` in subprocess env, and always uses token estimation (or unavailable usage when estimation fails). Sources: `v1/src/agents/aider.ts`, `v1/src/agents/token-estimation.ts`, `v1/docs/aider-model-warnings.md`

### Model and pricing visibility

- Each configured agent entry carries its own model string, and each adapter emits attribution labels as either known friendly names, raw model strings, or `<agent> (default model)` when no explicit model is configured. Sources: `v1/src/config.ts`, `v1/src/agents/claude.ts`, `v1/src/agents/codex.ts`, `v1/src/agents/cursor.ts`, `v1/src/agents/opencode.ts`, `v1/src/agents/aider.ts`
- Pricing support is adapter-specific: Claude/Codex/Cursor/Opencode report `agentHasPricedModels=true` while Aider reports `false`; price-key resolution is delegated per adapter and may return `null` for unsupported/unpriced model values. Sources: `v1/src/agents/price-keys.ts`, `v1/src/agents/claude.ts`, `v1/src/agents/codex.ts`, `v1/src/agents/cursor.ts`, `v1/src/agents/opencode.ts`, `v1/src/agents/aider.ts`
- Exact usage/cost visibility is mixed by adapter: Claude and Opencode can return agent-sourced usage/cost, Codex computes cost from correlated session usage plus local price table, Cursor/Aider primarily produce estimated usage, and any estimator/session-correlation miss is surfaced via `usage_source: "unavailable"` plus warnings. Sources: `v1/src/agents/types.ts`, `v1/src/agents/claude.ts`, `v1/src/agents/codex.ts`, `v1/src/agents/cursor.ts`, `v1/src/agents/opencode.ts`, `v1/src/agents/aider.ts`, `v1/src/agents/codex-session.ts`
- Patch-mode harness emits one-time operator stderr notices when successful Cursor or Opencode runs still have unavailable usage (`token usage not available for this CLI version`) and forwards adapter warnings with `<agent>: <warning>` prefix. Sources: `v1/src/modes/patch/run.ts`

### Quota detection and fallback semantics

- Spawn classification order is model-configuration first, then strict quota pattern matching, then generic error; only non-zero exits can classify as quota/model-config. Sources: `v1/src/agents/spawn.ts`, `v1/src/agents/quota.ts`
- Quota and model-configuration classification is regex-driven per adapter, with shared base model-config patterns and extra adapter-specific additions for Opencode/Aider provider-local failures. Sources: `v1/src/agents/quota.ts`, `v1/docs/quota-signals.md`
- `quotaFallback: "lenient"` can upgrade `kind: "error"` into `kind: "quota"` only when the caller-provided guard allows it; patch mode passes that guard only for no-progress iterations, preventing weak quota upgrades after observable repo progress. Sources: `v1/src/agents/quota.ts`, `v1/src/modes/patch/run.ts`, `v1/docs/quota-signals.md`
- Quota rotation and exhaustion stderr strings are shared constants: strict fallback uses `quota exhausted; falling back`, lenient upgraded fallback uses `probable quota-like error (exit N); falling back`, and terminal exhaustion uses `all agents quota-exhausted` (plan prefixes with `plan:` and may append phase suffixes). Sources: `v1/src/quota-harness-messages.ts`, `v1/src/modes/patch/run.ts`, `v1/src/modes/plan/emit-plan-quota-stderr.ts`, `v1/src/commands/plan.ts`, `v1/docs/quota-signals.md`

### Abort and process lifecycle

- All adapters execute via a shared spawn wrapper that launches the CLI in a detached process group, normalizes env with `PWD=<agent cwd>` and no `OLDPWD`, and buffers stdout/stderr until stream close + process close before final classification. Sources: `v1/src/agents/spawn.ts`, `v1/docs/agents.md`
- Patch-mode Ctrl-C handling aborts the current iteration controller and surfaces `interrupted`; agent subprocess abort handling then sends `SIGTERM` to the process group first and escalates to `SIGKILL` after a grace timeout. Sources: `v1/src/modes/patch/run.ts`, `v1/src/agents/spawn.ts`
- Aborted agent runs resolve as `kind: "error"` with `exitCode: -1` and `stderr` prefixed `aborted: <reason>`, so aborts are operator-visible as explicit harness-side failures rather than silent termination. Sources: `v1/src/agents/spawn.ts`, `v1/src/agents/types.ts`

## Git/GitHub behavior

### Worktrees and locks

- Patch runs derive the worktree directory and branch name from the parent directory name of the resolved spec path, and create/reuse `.worktree/<spec-name>` plus branch `<spec-name>` (including recreating a missing local branch from `origin/<spec-name>` when available). Sources: `v1/src/worktree.ts`
- If `jarvis run` is invoked from inside a checkout already on branch `<spec-name>`, worktree creation is skipped and the current checkout is reused as the agent working directory. Sources: `v1/src/worktree.ts`
- New patch branches are based on `gh repo view --json defaultBranchRef` (via `getBaseBranch`), while failures to `git fetch origin` are tolerated and do not stop worktree setup. Sources: `v1/src/worktree.ts`, `v1/src/gh.ts`
- Plan mode uses a separate namespace: `.worktree/plan-<name>` on branch `plan/<name>`, with an explicit hard error when the plan worktree path already exists. Sources: `v1/src/worktree.ts`
- Patch and review-feedback flows serialize per-worktree execution with `.jarvis.lock`; if an existing lock PID is still alive, the command exits with code `9` and stderr `worktree is in use by process <pid> (started at <timestamp>)`. Sources: `v1/src/worktree-lock.ts`, `v1/src/modes/patch/run.ts`, `v1/src/commands/review-feedback.ts`
- Stale lock recovery is automatic: when a lock file exists but its PID is dead, jarvis replaces the lock with the current process and records a harness log line about recovering a stale lock. Sources: `v1/src/worktree-lock.ts`, `v1/src/modes/patch/run.ts`
- `.jarvis.lock` exclusion is enforced best-effort through worktree-local `info/exclude` so normal `git add -A` commit paths do not stage lock files. Sources: `v1/src/worktree-lock.ts`
- Patch-mode run teardown always attempts to release `.jarvis.lock` for the active worktree once preflight marked it as acquired. Sources: `v1/src/modes/patch/run.ts`, `v1/src/worktree-lock.ts`

### Branches and commits

- Patch subspec completion commits are created by jarvis (not agent git automation) with subject equal to subspec H1, body first line `Spec: <relative subspec path>`, and embedded `## Acceptance criteria` section body copied from the subspec file. Sources: `v1/src/modes/patch/subspec.ts`
- Completing a subspec also flips the corresponding linked checklist entry in that subspec directory's `index.md` from `[ ]` to `[x]` before commit creation. Sources: `v1/src/modes/patch/subspec.ts`
- Progress and blocker iterations are committed as `WIP:` subjects with `Spec: <relative subspec path>` in the body, and blocker variants append a `## Blocker` section in commit message content. Sources: `v1/src/modes/patch/subspec.ts`
- All harness-authored commit shapes append `Jarvis-Agent: <label>` trailer when the agent label is non-empty; empty labels omit the trailer line entirely. Sources: `v1/src/commit-trailer.ts`, `v1/src/modes/patch/subspec.ts`, `v1/src/modes/patch/pr.ts`
- Push behavior is two-phase: first branch push uses `git push -u origin <current-branch>` and later pushes use plain `git push` once upstream tracking exists. Sources: `v1/src/worktree.ts`, `v1/src/modes/patch/run.ts`

### PR and GitHub CLI mediation

- GitHub connectivity/auth is preflight-gated through `gh auth status`; failures stop patch and review-feedback flows with surfaced stderr guidance rather than continuing without GitHub operations. Sources: `v1/src/gh.ts`, `v1/src/modes/patch/run.ts`, `v1/src/commands/review-feedback.ts`
- Base-branch discovery for new worktree branches is mediated by `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` and errors are surfaced as `failed to detect base branch: ...`. Sources: `v1/src/gh.ts`, `v1/src/worktree.ts`
- Draft PR creation is gh-mediated and idempotent per open branch PR: `gh pr view` filters to `OPEN` only, and `gh pr create --draft --base <base> --head <branch> --title <title> --body <body>` is called only when no open PR exists. Sources: `v1/src/pr.ts`
- Closed/merged PRs on the same branch are intentionally ignored by existence checks, so branch reuse can open a new draft PR instead of binding to historical PR state. Sources: `v1/src/pr.ts`
- Patch mode rewrites existing PR bodies via `gh pr edit <branch> --body-file -` using deterministic header regeneration and optional attribution footer refresh after subspec commits. Sources: `v1/src/pr.ts`, `v1/src/modes/patch/pr.ts`, `v1/src/modes/patch/run.ts`
- Patch-mode draft-to-ready transition requires an existing open PR, runs `bun run ready`, optionally creates/pushes `chore: apply pre-ready check:fix` if the ready gate dirties files, then calls `gh pr ready <branch>`. Sources: `v1/src/modes/patch/pr.ts`
- Plan-mode ready transition is PR-state aware: no-op when no open PR or already ready, and only draft PRs run `bun run ready` followed by `gh pr ready <branch>`. Sources: `v1/src/modes/plan/pr.ts`

### Attribution and PR footer behavior

- Patch PR attribution is derived from `git log <base>..HEAD` and includes only commits whose first non-empty body line starts with `Spec: `, excluding commits without that prefix from per-commit attribution bullets. Sources: `v1/src/pr.ts`
- Per-commit attribution bullets render as `- <short sha> <subject> — <label>`, where missing trailers map to `unknown` and multiple `Jarvis-Agent` trailers are joined with `, `. Sources: `v1/src/pr.ts`
- Footer summary line is first-seen deduped (`Written by <Label A>, <Label B> through Jarvis.`) and omitted when no labelled commits exist; the entire footer is omitted when no qualifying subspec commits are present. Sources: `v1/src/pr.ts`
- Patch PR body rewrites preserve only content between `<!-- jarvis:narrative:start -->` and `<!-- jarvis:narrative:end -->`; header and footer are regenerated each rewrite and manual edits outside narrative markers are not sticky. Sources: `v1/src/pr.ts`, `v1/src/modes/patch/pr.ts`
- Plan-mode attribution collapses consecutive plan meta-commits into a single summary bullet, while subspec commits remain individually listed, and both still contribute to the deduped `Written by ... through Jarvis.` summary ordering by first appearance. Sources: `v1/src/modes/plan/pr.ts`
- [uncertain] Plan-mode collapsed attribution bullets always use fixed text `spec commits (refine, draft, review)` even when the grouped meta commits may include blocker/resume variants, so the wording may be lossy relative to exact commit subjects. Sources: `v1/src/modes/plan/pr.ts`

## Filesystem, logging, telemetry, and other side effects

Subspec 04 is expected to fill this section with write boundaries, logs/telemetry emission, and other observable side effects that occur during v1 runs. Sources: `spec/2026-05-22T04-09-01Z-v1-behavior-catalog/04-side-effects-completion-and-failures.md`

## Completion, blockers, exit codes, and failure handling

Subspec 04 is expected to fill this section with completion semantics, blocker handling, and exit-code/failure behavior for patch and related workflows. Sources: `spec/2026-05-22T04-09-01Z-v1-behavior-catalog/04-side-effects-completion-and-failures.md`

## Behaviors with uncertain intent

Subspec 04 is expected to consolidate this section with `[uncertain]` entries where source indicates behavior but does not justify a clear policy intent. Sources: `spec/2026-05-22T04-09-01Z-v1-behavior-catalog/04-side-effects-completion-and-failures.md`

## Surprising or possibly vestigial behaviors

Subspec 04 is expected to consolidate this section with behavior that is observable in v1 but likely transitional, surprising, or vestigial. Sources: `spec/2026-05-22T04-09-01Z-v1-behavior-catalog/04-side-effects-completion-and-failures.md`

## Maintenance requirement for future v1 changes

Subspec 05 is expected to replace this stub with the long-lived maintenance requirement and reminder placement tied to the v2 rollout workflow. Sources: `spec/2026-05-22T04-09-01Z-v1-behavior-catalog/05-maintenance-reminder-and-final-verification.md`
