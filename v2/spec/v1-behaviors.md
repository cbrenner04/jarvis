# v1 behavior catalog for v2 parity review

This document inventories user-observable v1 behavior so v2 can explicitly preserve, change, or drop each item.

## Overview and scope

- This catalog describes behavior as shipped today under `v1/`, with v1 invoked via `jarvis1` in CLI usage and help text. Sources: `v1/src/cli.ts`
- The `jarvis1` rename has landed, so this file intentionally records the renamed `jarvis1` behavior as the migration baseline for v2 review. Sources: `v1/src/cli.ts`, `v1/spec/completed/2026-05-22T04-09-01Z-v1-behavior-catalog/00-skeleton-commands-and-project-resolution.md`
- Source files under `v1/src/` are treated as authority for behavior; docs are used to cross-check operator workflow expectations and terminology. Sources: `v1/src/cli.ts`, `v1/docs/run-loop.md`, `v1/docs/spec-guidance.md`
- Behavior entries in this catalog stay as short bullets ending with `Sources:` citations; `[uncertain]` is reserved for cases where source evidence cannot support a stronger claim. Sources: `v1/spec/completed/2026-05-22T04-09-01Z-v1-behavior-catalog/00-skeleton-commands-and-project-resolution.md`

## Commands and modes

### Command surface

- The shipped top-level subcommands are `run`, `init`, `config`, `log-server`, `cleanup`, `triage`, `review-feedback`, `plan`, `prices`, and `help` (including `-h`/`--help` aliases to help output). Sources: `v1/src/cli.ts`
- Unknown subcommands exit non-zero and print usage, while parse-time argument errors also print usage with a command-specific error prefix. Sources: `v1/src/cli.ts`
- `review-feedback` requires a non-empty `<worktree-name>` and exits with usage when omitted, while `triage` accepts an optional worktree argument and otherwise runs a no-arg listing mode. Sources: `v1/src/cli.ts`, `v1/src/commands/triage.ts`
- `prices` is a two-operation command surface (`show` and `edit`) rather than one flat action, and missing/unknown prices subcommands print command-specific usage. Sources: `v1/src/commands/prices.ts`, `v1/src/commands/prices-show.ts`, `v1/src/commands/prices-edit.ts`
- `cleanup` exposes a `--dry-run` mode and requires execution from inside a registered project or it exits with a targeted registration error. Sources: `v1/src/cli.ts`, `v1/src/commands/cleanup.ts`

### Patch-mode run workflow

- `jarvis1 run` accepts `--max-iterations`, `--repo`, and `--cwd` around a required `<spec-path>`, then forwards those into run-mode options after validating numeric bounds for max iterations. Sources: `v1/src/cli.ts`, `v1/src/modes/patch/run.ts`
- Default implementation runs are index-routed: operators are expected to run against an `index.md` tree where one unchecked linked subspec is selected per agent iteration. Sources: `v1/docs/spec-guidance.md`, `v1/docs/run-loop.md`
- Non-index spec runs prompt for explicit operator action instead of silently proceeding as a normal index loop. Sources: `v1/docs/spec-guidance.md`, `v1/docs/run-loop.md`
### Non-git (loop-only) mode

- Effective `git` resolves per-run from the top-level `git` flag overlaid by the resolved project's `projects.<key>.git` override; `--repo`/`--cwd` and ad-hoc resolution all funnel through the same effective value. Sources: `v1/src/config.ts` (`effectiveGit`), `v1/src/modes/patch/run.ts`
- When effective `git` is `false`, patch mode runs "loop-only": no worktree is created, the agent's `cwd` is the resolved project root (or `--cwd <dir>` when supplied), and no per-subspec commit, push, draft-PR open, or ready-on-complete occurs. Sources: `v1/src/modes/patch/run.ts`, `v1/docs/run-loop.md`
- In loop-only mode completion is purely "zero unchecked boxes": the clean-tree requirement and exit `6` do not apply, and `worktreeSymlinks` is ignored. Sources: `v1/src/modes/patch/run.ts`, `v1/docs/run-loop.md`
- `--cwd <dir>` is only valid when effective `git` is `false` and must point at an existing directory; combining it with `git: true` exits `1`, and a missing `--cwd` directory exits `1`. Sources: `v1/src/modes/patch/run.ts`, `v1/docs/run-loop.md`
- With `git: true`, a resolved root that is not a `.git` checkout exits `1` before any agent runs, with guidance to set `"git": false` or pass `--repo` to a git checkout. Sources: `v1/src/modes/patch/run.ts`, `v1/docs/run-loop.md`

### Plan mode

- `jarvis1 plan` is a separate mode entrypoint with its own parser, usage text, and handler; `--help` exits `0` with plan-specific usage while parse errors (unknown flags, missing values, too many args, combining `--resume` + `--resume-draft`) exit `1` with targeted `plan:` messages. Sources: `v1/src/cli.ts`, `v1/src/commands/plan.ts`, `v1/src/commands/plan-args.ts`
- Plan-mode flag surface includes exactly `--refine-turns`, `--review-passes`, `--repo`, `--cwd`, `--resume`, and `--resume-draft`, with non-negative integer validation for refine/review counts. Sources: `v1/src/cli.ts`, `v1/src/commands/plan.ts`, `v1/src/commands/plan-args.ts`
- The single positional argument is interpreted as an existing file path in normal mode and as inline intent text otherwise, but in `--resume`/`--resume-draft` modes it is always treated as a spec path (never inline text fallback). Sources: `v1/src/commands/plan-args.ts`
- `--resume` requires a path ending in `index.md`, while `--resume-draft` requires `intent.md`; both derive plan identity from the parent spec directory basename (with timestamp prefix stripping for plan branch/worktree naming). Sources: `v1/src/commands/plan.ts`
- Plan mode supports interactive/no-arg, file, and inline entry flows. Interactive mode seeds a placeholder `intent.md` and relies on the refine phase to gather the intent, so it rejects `--refine-turns 0` (exit `1`, "incompatible with interactive mode") because there is no seed intent content and no turns to gather it. Sources: `v1/src/commands/plan.ts` (`seedIntentFile`), `v1/src/commands/plan-args.ts`
- Inline intent mode runs a dedicated one-shot inline-draft agent pass that rewrites only the generated `spec/wip-intents/*.md` intent file and returns without entering refine/draft/review phases. Sources: `v1/src/commands/plan.ts`, `v1/src/modes/plan/inline-draft.ts`, `v1/src/modes/plan/prompts/inline-draft.md`
- File/interactive plan flows seed an intent file and then run an agent-driven phase pipeline: intent seeding, refine phase (controlled by `--refine-turns`, default `3`), draft phase, then review passes (controlled by `--review-passes`, default `2`) with explicit per-pass stderr milestones. Sources: `v1/src/commands/plan.ts`, `v1/src/modes/plan/refine.ts`, `v1/src/modes/plan/draft.ts`, `v1/src/modes/plan/review.ts`
- The pipeline is not always end-to-end in one invocation: for `commit: true` file-mode plans, the run stops after the refine phase by appending a Phase-0 review-gate `## Blocker` to `intent.md` and exits `1`; drafting and review only run after the operator clears the blocker and reruns with `--resume-draft`. Interactive (`commit: true`) and all `commit: false` flows instead continue through draft and review in a single invocation. Sources: `v1/src/commands/plan.ts` (`shouldStopAfterPhase0Refine`, `appendPhase0ReviewGateBlocker`)
- When `--refine-turns 0` is set in non-interactive (file/inline) mode, the refine phase is skipped and a dedicated name-only agent phase runs instead to propose the spec name; `--refine-turns 0` in interactive mode is rejected. Sources: `v1/src/commands/plan.ts`, `v1/src/modes/plan/name-only.ts`
- Refine behavior is append-only on intent body and must end each turn with one of `## Refine turn N`, `## Refine skip`, or `## Blocker`; invalid intent rewrites are surfaced as errors and stop phase progress. Sources: `v1/src/modes/plan/refine.ts`, `v1/src/modes/plan/prompts/refine.md`
- Draft behavior requires index generation plus numbered subspecs and treats blocker insertion in `intent.md` as a valid stop state; otherwise missing `index.md` or missing numbered subspecs fail validation. Sources: `v1/src/modes/plan/draft.ts`, `v1/src/modes/plan/prompts/draft.md`
- Review behavior snapshots current spec markdown into prompt context, forbids `intent.md` rewrites except blocker append, validates `index.md` still exists, and can skip committing a pass when no changes were produced. Sources: `v1/src/modes/plan/review.ts`, `v1/src/modes/plan/prompts/review.md`, `v1/src/commands/plan.ts`
- Plan prompts are intentionally data-delimited and placeholder-guarded so intent/spec text is treated as content, not executable instructions; literal placeholder token collisions are surfaced as `model_config`-class fatal errors (`exit 3` in command flow). Sources: `v1/src/modes/plan/inline-draft.ts`, `v1/src/modes/plan/refine.ts`, `v1/src/modes/plan/draft.ts`, `v1/src/modes/plan/review.ts`, `v1/src/commands/plan.ts`
- Plan uses `modes.plan.agentOrder` and per-attempt quota classification like patch mode, but its fallback stderr is explicitly prefixed per agent as `plan: <agent>: <quota-fallback-line>` for phase-level diagnostics. Sources: `v1/src/commands/plan.ts`, `v1/src/modes/plan/emit-plan-quota-stderr.ts`, `v1/src/quota-harness-messages.ts`
- Plan exit semantics include `0` on successful completion, `2` on all-agents quota exhaustion, `3` on model configuration errors, `130` on SIGINT checkpoints, and `1` on blockers/validation/hard failures; completion may still print usage summary output when telemetry has agent attempts. Sources: `v1/src/commands/plan.ts`, `v1/src/modes/plan/refine.ts`, `v1/src/modes/plan/draft.ts`, `v1/src/modes/plan/review.ts`
- Resume invocations track prior plan commit history to continue numbering (`plan: review <N>`) and append `r<n>` resume suffixes to resumed refine/review/blocker commit subjects for later attribution and chronology. Sources: `v1/src/commands/plan.ts`, `v1/src/modes/plan/commits.ts`
- Plan `commit: true` mode creates a dedicated `plan/<name>` branch and `.worktree/plan-<name>` worktree, opens/updates a draft PR after draft commits, rewrites PR header/footer on each plan commit, and attempts auto-ready transition only when an open PR is still draft. Sources: `v1/src/commands/plan.ts`, `v1/src/worktree.ts`, `v1/src/modes/plan/pr.ts`, `v1/src/pr.ts`
- Plan `commit: false` mode writes spec output to Jarvis-owned external spec roots and emits absolute-path next-step commands for later `jarvis1 run` execution instead of creating git commits, pushes, or PR transitions. Sources: `v1/src/commands/plan.ts`, `v1/src/modes/plan/spec-paths.ts`, `v1/docs/plan-mode.md`
- Plan mode enforces a write boundary before each draft/review commit: agent writes must stay within the active spec directory (and, for `commit: false`, the external spec root). On a boundary violation, commit-mode plans revert the offending paths, append a boundary `## Blocker`, commit a `plan: blocker`, and exit `1`; no-commit plans append the blocker and exit `1` without reverting. Sources: `v1/src/commands/plan.ts`, `v1/src/modes/plan/boundary.ts`

### Plan-mode flow matrix

Which phases actually run in a single invocation depends on the entry mode and the resolved `commit` flag. This consolidates the prose bullets above:

| Entry mode | `commit` | Phases that run in one invocation | Stop / handoff |
| --- | --- | --- | --- |
| inline (text arg) | any | one-shot inline-draft pass; rewrites `spec/wip-intents/<slug>.md` only | returns `0`; no refine/draft/review, no worktree or PR |
| file (path arg) | `true` | refine only, then a Phase-0 review-gate `## Blocker` | exits `1`; operator clears blocker and reruns `--resume-draft` for draft+review |
| file (path arg) | `false` | refine → draft → review (into external spec root) | exits `0`; prints `jarvis1 run <indexPath>` next step |
| interactive (no arg) | `true` | refine (gathers intent) → draft → review | exits `0`; opens/refreshes draft PR, attempts ready transition |
| interactive (no arg) | `false` | refine → draft → review (into external spec root) | exits `0`; prints next-step command |

Sources: `v1/src/commands/plan.ts`, `v1/src/modes/plan/inline-draft.ts`

- `--refine-turns 0` substitutes a name-only agent phase for refine in file/inline mode; interactive rejects it (see Plan mode bullets above). Sources: `v1/src/commands/plan.ts`, `v1/src/modes/plan/name-only.ts`
- `commit: true` plans run under a temporary `plan/tmp-<id>` branch/worktree that is renamed to `plan/<name>` and `.worktree/plan-<name>` once the agent proposes a valid spec name; name collisions append a numeric suffix. Sources: `v1/src/commands/plan.ts` (`deriveSpecName`, `ensureUniquePlanName`)

## Spec authoring and implementation workflows

- New implementation specs are expected to be authored as index-routed trees (`index.md` + numbered subspec files) with checklist links from index into atomic subspec documents. Sources: `v1/docs/spec-guidance.md`
- The documented workflow requires spec-first sequencing: create a spec PR, merge spec files to `main`, and only then start implementation runs against that merged spec. Sources: `v1/docs/spec-guidance.md`
- `jarvis1 plan` can generate spec trees, but generated specs follow the same merge-first rule before `jarvis1 run` implementation work begins. Sources: `v1/docs/spec-guidance.md`, `v1/docs/workflows.md`
- External plan output (`modes.plan.commit: false`) produces Jarvis-owned spec trees written to a configured external spec root directory (not inside the target repo) with a required `repo:` binding so later `jarvis1 run` invocations can resolve the target checkout. Sources: `v1/src/modes/plan/spec-paths.ts`, `v1/docs/spec-guidance.md`, `v1/docs/config.md`

## Config and project resolution

### Config storage and bootstrap

- Jarvis stores state under `~/.jarvis/` with `config.json`, and configuration is auto-bootstrapped on first run rather than requiring manual initialization. Sources: `v1/src/config.ts`, `v1/docs/config.md`
- The config defaults to schema version 2 with mode-specific agent order blocks (`modes.patch.agentOrder` and `modes.plan.agentOrder`) and project registry storage under `projects`. Sources: `v1/src/config.ts`, `v1/docs/config.md`
- The config exposes behavior knobs beyond agent order (quota policy, timeouts, log server, telemetry, git toggle, worktree symlinks); see the [Configuration field reference](#configuration-field-reference) below for the full enumeration and defaults. Sources: `v1/src/config.ts`, `v1/docs/config.md`
- Each registered project may declare `siblings`: absolute paths passed to the agent as additional readable directories alongside the spec. Patch preflight errors with exit `1` if a configured sibling does not exist. Sources: `v1/src/config.ts`, `v1/src/modes/patch/run.ts`
- Invalid config structure is rejected with file-specific validation errors instead of partial best-effort reads. Sources: `v1/src/config.ts`
- `jarvis1 init` only registers repos under `~/Work` by deriving the project key from the path relative to that root, and it records `origin` only when `git remote get-url origin` yields a non-empty value. Re-registering the same name+root is idempotent; the same name pointing at a different root errors. Sources: `v1/src/commands/init.ts`, `v1/src/config.ts`

### Configuration field reference

Top-level `~/.jarvis/config.json` fields and their runtime effect (defaults from `DEFAULT_CONFIG`). Sources: `v1/src/config.ts`, `v1/docs/config.md`.

| Field | Default | Effect |
| --- | --- | --- |
| `version` | `2` | Schema version; only `2` is accepted. `1` (or legacy `agentOrder`/`planAgentOrder`/`patchModels` keys) is rejected with migration guidance. |
| `modes.patch.agentOrder` | `claude`/`haiku`, `codex`/`gpt-5.3-codex`, `cursor`/`Composer 2` | Ordered agent+model entries for patch runs; advanced on quota. |
| `modes.plan.agentOrder` | same as patch default | Ordered agent+model entries for plan phases. |
| `modes.plan.{specTimestamp,commit,targetDir}` | `true` / `true` / `"spec"` | Plan output routing; each is overridable per project under `projects.<key>.plan`. |
| `quotaFallback` | `"lenient"` | `strict` vs `lenient` weak-quota upgrade policy. |
| `weakQuotaExitCodes` | `[]` | Exit codes treated as weak-quota signals under lenient policy. |
| `maxIterations` | `10` | Patch iteration cap; `--max-iterations <n>` overrides. |
| `iterationTimeoutMs` | `1800000` (30 min) | Per-iteration watchdog timeout → exit `8`. |
| `runTimeoutMs` | unset | Optional whole-run timeout → exit `8`. |
| `logServerUrl` | `http://127.0.0.1:4310/logs` | Endpoint for preflight + log sends. |
| `logServerBind` | `127.0.0.1:4310` | Bind address for `jarvis1 log-server`. |
| `telemetryPath` | `~/.jarvis/runs.jsonl` | JSONL telemetry path; `null` disables telemetry. |
| `worktreeSymlinks` | unset | Paths symlinked from project root into each created worktree (ignored in non-git mode). |
| `git` | `true` | Global git participation toggle; per-project `projects.<key>.git` overrides. |
| `projects` | `{}` | Registry keyed by name → `{ root, origin?, git?, siblings?, plan? }`. |

- Validation is strict: unknown top-level/project/plan keys, non-absolute or duplicate project roots, empty model strings, unknown agent names, and priced-but-unknown models are all rejected with file-specific errors. Sources: `v1/src/config.ts`

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
- Both patch and plan modes execute agents in their configured order and advance only when an agent result is classified as quota-related; if the active agent returns a non-quota hard error, the mode stops instead of trying later agents. Sources: `v1/src/modes/patch/run.ts`, `v1/src/commands/plan.ts`, `v1/src/agents/quota.ts`

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
- Patch mode enforces two timeouts that both surface as exit `8`: a per-iteration timeout (`iterationTimeoutMs`, default 30 minutes) and an optional whole-run timeout (`runTimeoutMs`). On iteration timeout a watchdog `SIGTERM`s the agent process group and escalates to `SIGKILL` after a grace period (5s), in addition to aborting the iteration controller; telemetry distinguishes `watchdog-iteration-timeout` from `iteration-timeout` and records the watchdog pgid. Sources: `v1/src/modes/patch/run.ts`, `v1/src/agents/spawn.ts`

## Git/GitHub behavior

### Worktrees and locks

- Patch runs derive the worktree directory and branch name from the parent directory name of the resolved spec path, and create/reuse `.worktree/<spec-name>` plus branch `<spec-name>` (including recreating a missing local branch from `origin/<spec-name>` when available). Sources: `v1/src/worktree.ts`
- If `jarvis1 run` is invoked from inside a checkout already on branch `<spec-name>`, worktree creation is skipped and the current checkout is reused as the agent working directory. Sources: `v1/src/worktree.ts`
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
- Cross-reference: plan-mode collapsed attribution wording has a fixed label that can be lossy relative to grouped commit variants; see `## Behaviors with uncertain intent`. Sources: `v1/src/modes/plan/pr.ts`

## Filesystem, logging, telemetry, and other side effects

- `run` and `plan` both run a mandatory log-server reachability preflight (default `http://127.0.0.1:4310/logs`) after repo resolution and before agent work; failures print a specific `jarvis1: log server unreachable at <url>. Start it with \`jarvis1 log-server\` or update config.` banner plus error detail and exit `1`. (`run` runs this inside `runSharedPreflight`; `plan` runs it via `enterMode`/`runModeLogPreflight`.) Sources: `v1/src/modes/shared-entry.ts`, `v1/src/mode-entry.ts`, `v1/src/log-server-preflight.ts`
- Log-server health checks and normal log sends are HTTP `POST` JSON payloads to the configured URL, and non-2xx responses are treated as transport failures (`log server returned HTTP <status>`). Sources: `v1/src/logging.ts`
- After preflight succeeds, harness log forwarding is fire-and-forget; log send failures are swallowed so agent iteration can proceed, with on-disk session logs treated as the authoritative record. Sources: `v1/src/modes/patch/run.ts`
- Patch runs always open a session log file under the configured sessions directory (`~/.jarvis/sessions/<namespace>-<timestamp>.log`), write timestamped `[tag]` lines (`harness`, `outbound`, `inbound_stdout`, `inbound_stderr`), and close the FD during finalize. Plan mode does not open an on-disk session log at all: it only forwards best-effort `harness`-tagged lines to the log server (`planHarnessLog`) and writes telemetry, so plan diagnostics depend on the log server and telemetry rather than a session file. Sources: `v1/src/modes/patch/run.ts`, `v1/src/config.ts` (`openSessionLog`), `v1/src/commands/plan.ts`
- Telemetry writes are append-only JSONL rows to `telemetryPath` (when configured), with parent directories auto-created and one row per invocation plus optional `run_terminal` rows for run exit state. Sources: `v1/src/telemetry.ts`, `v1/src/modes/patch/run.ts`
- Telemetry usage/cost enrichment normalizes unavailable usage to explicit null token fields + `cost_source: "no-usage"`, and otherwise may compute USD from local price tables when usage exists and a price key resolves. Sources: `v1/src/telemetry-enrichment.ts`
- When telemetry rows exist for the run namespace/time window, patch finalize prints a human-readable run summary (iterations/attempts/duration/cost table) to stdout; malformed telemetry lines are ignored rather than failing the run. Sources: `v1/src/run-summary.ts`, `v1/src/modes/patch/run.ts`
- Patch run preflight may persist config side effects by lazily backfilling missing registered-project `origin` from git remote URL when available, but failures in this best-effort update do not block execution. Sources: `v1/src/modes/patch/run.ts`, `v1/src/config.ts`, `v1/src/commands/init.ts`
- Before iterating, patch preflight emits a non-fatal stderr warning when an unmerged `plan/<spec-name>` branch still exists on `origin` (i.e. the plan PR has not been merged into the default branch), advising the operator to run after merging to avoid drift between the on-disk spec and the merged spec. The check is best-effort and skipped in non-git mode. Sources: `v1/src/modes/patch/run.ts` (`maybeWarnAboutUnmergedPlanBranch`)

## Completion, blockers, exit codes, and failure handling

### Patch mode

- Patch spec completion is checkbox-driven: parser counts unchecked GitHub-task items, and a spec with zero task items is malformed (`MalformedSpecError`) rather than complete. Sources: `v1/src/modes/patch/completion.ts`, `v1/src/modes/patch/spec.ts`
- For index-routed runs, the active subspec is the first unchecked linked task in `index.md`; if no linked unchecked item exists, active subspec resolution returns `undefined` and iteration logic falls back to top-level checklist progress only. Sources: `v1/src/modes/patch/completion.ts`, `v1/src/modes/patch/spec.ts`, `v1/src/modes/patch/run.ts`
- If the active subspec has no exact `## Acceptance criteria` checklist items, patch run stops with exit `1` and prints parser-warning details when near-miss headings (wrong case/level) were detected. Sources: `v1/src/modes/patch/run.ts`, `v1/src/modes/patch/spec.ts`
- Blocker detection is exact-header based (`## Blocker`): pre-existing blocker body causes immediate blocked exit `7`, and newly added blocker body during an iteration also exits `7` (with WIP blocker commit/push in git mode before exiting). Sources: `v1/src/modes/patch/blocker.ts`, `v1/src/modes/patch/spec.ts`, `v1/src/modes/patch/run.ts`
- Spec checklists can be complete while run still exits `6` when git worktree state blocks completion (dirty/unpushed state surfaced via `worktreeCompletionBlocker` guidance and `jarvis1 triage` hint). Sources: `v1/src/modes/patch/run.ts`, `v1/src/worktree.ts`
- Exit reasons are mapped from run codes in patch mode as: `0` criteria complete, `1` error, `2` quota exhausted, `3` agent/model hard failure, `4` no progress, `5` max iterations, `6` dirty worktree/completion blocker, `7` blocked, `8` timeout, `9` worktree lock busy, and `130` SIGINT. Sources: `v1/src/modes/patch/run.ts`
- Agent-failure pipeline classifies non-zero exits in strict order (`model_config` before strict quota before generic error), merges stderr+stdout into diagnostics on errors, and only allows weak/lenient quota upgrades in mode-controlled no-progress contexts. Sources: `v1/src/agents/spawn.ts`, `v1/src/agents/quota.ts`, `v1/docs/agent-cli-failure-pipeline.md`, `v1/src/modes/patch/run.ts`
- Patch-mode fallback policy differs by error class: strict quota rotates to next configured agent, model-config fails fast with no fallback, and non-quota errors only rotate under lenient weak-quota rules; otherwise run exits `3`. Sources: `v1/src/modes/patch/run.ts`, `v1/src/agents/quota.ts`

### Plan mode

- Plan mode completion is spec-driven: refine/draft phases produce spec output, and review phase validates that `index.md` exists and completion is signaled by zero review-pass changes or explicit blocker insertion in `intent.md`. Sources: `v1/src/modes/plan/refine.ts`, `v1/src/modes/plan/draft.ts`, `v1/src/modes/plan/review.ts`
- Plan exit semantics include `0` on successful completion, `2` on all-agents quota exhaustion, `3` on model configuration errors, `130` on SIGINT checkpoints, and `1` on blockers/validation/hard failures. Sources: `v1/src/commands/plan.ts`
- Plan mode blocker behavior: blocker insertion in `intent.md` during refine phase stops the run with exit `1`, and blocker content is preserved in both draft and review phases. Sources: `v1/src/modes/plan/refine.ts`, `v1/src/modes/plan/draft.ts`, `v1/src/modes/plan/review.ts`

## Behaviors with uncertain intent

Items marked `[uncertain]` need additional evidence (code inspection, tests, or documentation review) to confirm or clarify their intent.

- Plan-mode `plan: refine` commits are created with an empty agent label (`appendAgentTrailer(message, "")`), so they carry no `Jarvis-Agent` trailer even though the refine phase runs agent turns and tracks the agent's label internally. In the PR footer these refine commits are collapsed as meta-commits and a refine-only group renders `— Jarvis` (not `— unknown`); the refining agent never appears in the `Written by … through Jarvis.` summary. Whether refine work should attribute the agent that performed it is a v2 decision. Sources: `v1/src/modes/plan/commits.ts` (`commitPlanRefine`), `v1/src/modes/plan/pr.ts` (`renderPlanAttribution`), `v1/src/modes/plan/refine.ts`
- [uncertain] Plan-mode collapsed attribution bullets always use fixed text `spec commits (refine, draft, review)` even when grouped commits include blocker/resume variants, so the label can lose subject-level detail; evidence needed: design rationale or test coverage explaining why lossy wording is preferred. Sources: `v1/src/modes/plan/pr.ts`
- [uncertain] `parsePatchSpec` captures only the last exact `## Acceptance criteria` section and last exact `## Blocker` section when duplicates exist, but v1 does not document whether duplicate sections are invalid or intentionally "last one wins;" evidence needed: spec parser test coverage or explicit behavior documentation. Sources: `v1/src/modes/patch/spec.ts`

## Surprising or possibly vestigial behaviors

Items tagged **[v2-cleanup candidate]** are dead or vestigial code paths flagged for explicit drop/keep decisions during v2 design.

- **[v2-cleanup candidate]** For a non-index spec, normal CLI use never reaches the agent loop: mode-specific preflight prints a prompt (switch to a sibling `./index.md`, if present, or exit) and the default/empty answer returns exit `0` before any agent runs. The `runIteration` branch that runs a single non-index iteration and returns `0` after `criteria-progress` is therefore effectively dead in production — it is only reachable via the test-only `confirmRun` seam, so the `!isIndexSpec` iteration handling can likely be removed in v2. Sources: `v1/src/modes/patch/run.ts` (`resolveModeSpecificPreflight`, `runIteration`)
- Log-server connectivity is a hard gate for both patch and plan modes even though post-preflight log delivery failures are ignored; this makes local observability service availability stricter than later per-message reliability. Sources: `v1/src/mode-entry.ts`, `v1/src/log-server-preflight.ts`, `v1/src/modes/patch/run.ts`
- The fallback non-index prompt defaults to `exit` on empty or unrecognized input, so a mistaken Enter can terminate `jarvis1 run` without any agent attempt. Sources: `v1/src/modes/patch/run.ts`

## Maintenance requirement for future v1 changes

- Any v1 bug fix or user-observable behavior change that can affect v2 parity decisions must update this catalog in the same change window, so v2 design/review never relies on stale v1 behavior documentation. Sources: `v1/spec/completed/2026-05-22T04-09-01Z-v1-behavior-catalog/05-maintenance-reminder-and-final-verification.md`
- Required updates include command-surface changes, agent/model/quota behavior changes, git/GitHub workflow changes, and exit/blocker semantics, with each new or revised bullet ending in `Sources:` citations to the governing `v1/src` authority. Sources: `v1/spec/completed/2026-05-22T04-09-01Z-v1-behavior-catalog/index.md`, `v1/spec/completed/2026-05-22T04-09-01Z-v1-behavior-catalog/05-maintenance-reminder-and-final-verification.md`
- If a behavior change lands with unresolved ambiguity, record it explicitly using `[uncertain]` plus a short explanation instead of leaving uncertainty implicit, so later v2 reviewers can make a conscious preserve/change/drop decision. Sources: `v1/spec/completed/2026-05-22T04-09-01Z-v1-behavior-catalog/index.md`, `v1/spec/completed/2026-05-22T04-09-01Z-v1-behavior-catalog/05-maintenance-reminder-and-final-verification.md`
