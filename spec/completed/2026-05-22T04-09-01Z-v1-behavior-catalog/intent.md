---
name: v1-behavior-catalog
---

Produce a high-level catalog of every user-facing behavior in v1 so v2 has a shared source of truth for what it must preserve. This is step 3 of the v2 rollout; see `v2-vision.md` for context. It depends on the v1/v2 split and the `jarvis` -> `jarvis1` rename having landed. The resulting implementation work should assume v1 lives under `v1/` and is invoked as `jarvis1`.

The generated spec should be explicit enough for agents to execute without live human clarification. Use a `## Blocker` only when the work cannot be planned or implemented responsibly from source and local docs, such as a missing prerequisite tree or a contradiction that would make the catalog materially misleading.

## Goal

Create one reviewable catalog document at `v2/spec/v1-behaviors.md`. The catalog should let a reader who has never run Jarvis understand, at a glance, every behavior v1 exposes. It is the input for the v2 architecture design intent and for later v2 behavior-build intents.

The catalog is a behavior inventory, not a reimplementation spec. It should be complete enough to review for parity decisions, but it should not try to explain v1's internal code structure or prescribe v2 design.

## Planning expectations

Prefer a small number of source-audit slices that can each be completed independently and reviewed in one PR. A reasonable decomposition is:

The planned subspecs should require source-first auditing. They may use README/help output/tests/docs as cross-checks, but not as the primary source of truth.

When source leaves something ambiguous, the implementation should record that ambiguity in the catalog itself with an uncertainty tag and enough context for later PR review.

## What counts as behavior

Catalog every user-observable v1 behavior.

## Catalog shape

The catalog should be grouped by area rather than presented as one flat list. Suggested sections:

- Overview and scope
- Commands and modes
- Spec authoring and implementation workflows
- Config and project resolution
- Agent adapters, model selection, and quota fallback
- Git/GitHub behavior
- Filesystem, logging, telemetry, and other side effects
- Completion, blockers, exit codes, and failure handling
- Behaviors with uncertain intent
- Surprising or possibly vestigial behaviors
- Maintenance requirement for future v1 changes

Each behavior entry should be short: enough for a reviewer to recognize and discuss the behavior, not enough to rebuild it. Where appropriate, tag entries with a confidence/status note.

Describe what the source shows, what the intent is. If the intent is unclear, record why and what decision later review should make.

## Maintenance requirement

While v1 remains active during v2 development, any v1 bug fix or behavior change must update `v2/spec/v1-behaviors.md` when user-observable behavior changes. The generated spec should include this maintenance rule in the catalog and, if needed, update prompts and nearby v2/v1 docs so future work sees the requirement.

## Refine turn 1

### Prerequisite status

The v1/v2 repo split has landed (all v1 source is under `v1/`). The `jarvis → jarvis1` binary rename has **not** landed yet — the current binary is `bin/jarvis`, not `bin/jarvis1`. The catalog work can proceed regardless: the agent authoring it should document behaviors as they exist today (invoked as `jarvis`) and note the pending rename in the Overview section. The catalog need not block on the rename.

### Complete command surface

The CLI exposes these subcommands (from `v1/src/cli.ts`): `run`, `init`, `config`, `log-server`, `cleanup`, `triage`, `review-feedback`, `plan`, `prices`, `help`. The `triage`, `review-feedback`, `log-server`, and `prices` commands are lightly documented relative to `run` and `plan`. All nine commands plus `help` must appear in the catalog.

### Complete agent roster

Five agent adapters exist: `claude`, `codex`, `cursor`, `opencode`, `aider` (from `v1/src/agents/types.ts`). The catalog must cover all five, not just the default three (`claude → codex → cursor`).

### Decomposition

The intent left "A reasonable decomposition is:" blank. Proposed subspecs that produce sections of `v2/spec/v1-behaviors.md` sequentially:

- **00-skeleton-and-commands**: Create the catalog skeleton (all section headers, empty bodies, overview, binary name note). Audit and fill in: Commands and modes, Spec authoring and implementation workflows, Config and project resolution. Primary sources: `v1/src/cli.ts`, `v1/src/config.ts`, `v1/src/commands/`, `v1/docs/config.md`, `v1/docs/spec-guidance.md`.
- **01-agents-and-quota**: Audit and fill in: Agent adapters, model selection, quota fallback. Primary sources: `v1/src/agents/` (all five adapters), `v1/src/agents/quota.ts`, `v1/docs/quota-signals.md`, `v1/docs/agents.md`.
- **02-git-github**: Audit and fill in: Git/GitHub behavior (worktrees, PRs, commits, trailers, draft PRs, attribution footers, plan-mode PR lifecycle). Primary sources: `v1/src/pr.ts`, `v1/src/worktree.ts`, `v1/src/commit-trailer.ts`, `v1/src/modes/patch/pr.ts`, `v1/src/modes/plan/pr.ts`, `v1/docs/worktrees-and-commits.md`.
- **03-plan-mode**: Audit and fill in a dedicated Plan mode subsection within Commands and modes (or a separate top-level section if warranted). Primary sources: `v1/src/modes/plan/` (all files), `v1/src/commands/plan.ts`, `v1/docs/plan-mode.md`.
- **04-side-effects-completion**: Audit and fill in: Filesystem/logging/telemetry/side effects, Completion/blockers/exit codes/failure handling, and the Behaviors with uncertain intent and Surprising or vestigial behaviors sections. Primary sources: `v1/src/logging.ts`, `v1/src/telemetry.ts`, `v1/src/modes/patch/completion.ts`, `v1/src/modes/patch/blocker.ts`, `v1/src/run-summary.ts`, `v1/docs/agent-cli-failure-pipeline.md`.
- **05-maintenance**: Add the Maintenance requirement section to the catalog; add a maintenance reminder to `CLAUDE.md` or the relevant v2 planning doc so future v1 changes surface this obligation. Verify the full catalog for structural completeness (all intended sections present, no placeholder text).

Each subspec's acceptance criteria should check that its assigned catalog sections exist in `v2/spec/v1-behaviors.md`, that each entry cites its source file, and that ambiguous behaviors carry an `[uncertain]` tag with a brief explanation.

### Document assembly strategy

Each subspec appends to or fills in sections of `v2/spec/v1-behaviors.md`. Subspec 00 creates the file with a skeleton; subsequent subspecs fill their sections without removing others. This works safely because Jarvis runs subspecs sequentially.

### Out of scope for this catalog

Internal implementation details (call graphs, module boundaries, TypeScript types) and v2 design decisions. The catalog describes *what* users observe, not *how* v1 achieves it or *how* v2 should replicate it.

## Refine turn 2

### Agent adapter file clarifications

Repo inspection confirms the five adapters in `v1/src/agents/types.ts`: `claude`, `codex`, `cursor`, `opencode`, `aider`. Three other files in that directory are **utilities, not adapters** and should not appear as separate catalog entries:
- `claude-json.ts` — parses Claude's JSON output envelope (stdout parser)
- `codex-session.ts` — tracks Codex session file state on disk
- `cursor-tokens.ts` — cursor-specific token handling

These are implementation details but may surface as observable side effects (e.g., Codex leaving session files on disk). Subspec 01 should note them only if they produce user-visible behavior.

### Additional source files to include per subspec

The source lists in Refine turn 1 are correct but incomplete. Agents should also read:

**00-skeleton-and-commands:**
- `v1/src/disambiguation-prompt.ts` — project resolution disambiguation prompt shown to users when repo is ambiguous
- `v1/src/resolve-project.ts` and `v1/src/repo.ts` — project resolution logic (backs Config and project resolution section)
- `v1/docs/run-loop.md` — authoritative description of repo resolution order and preflight checks
- `v1/docs/workflows.md` — workflow documentation that may describe user-observable patterns

**01-agents-and-quota:**
- `v1/src/quota-harness-messages.ts` — defines grep-stable stderr constants `HARNESS_QUOTA_FALLBACK_STRICT` and `HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED` shared between patch and plan modes; user-observable via stderr output
- `v1/src/agents/token-estimation.ts` and `v1/src/agents/price-keys.ts` — token estimation and pricing key lookup (surfaces in cost tracking and model selection behavior)
- `v1/docs/aider-model-warnings.md` — documents aider-specific model warning behavior

**02-git-github:**
- `v1/src/gh.ts` — GitHub CLI wrapper; backs PR creation, listing, and other `gh`-mediated behaviors
- `v1/src/worktree-lock.ts` — worktree locking behavior; user-observable if a stale lock blocks a run

**03-plan-mode:**
- `v1/src/modes/plan/prompts/` subdirectory — prompt templates for plan mode phases (refine, draft, review); content here defines what plan mode sends to agents
- `v1/src/modes/plan/inline-draft.ts` and `v1/src/modes/plan/emit-plan-quota-stderr.ts` — inline draft behavior and quota stderr emission specific to plan mode

**04-side-effects-completion:**
- `v1/src/telemetry-enrichment.ts` — enriches telemetry with usage/cost fields computed from agent results; distinct from `telemetry.ts`
- `v1/src/modes/patch/prompt.ts` and `v1/src/modes/patch/spec.ts` — prompt construction and spec parsing for patch mode; may have observable behaviors (e.g., prompt format, spec parsing rules)

### Prices command structure

The `prices` command has two sub-operations backed by separate files (`v1/src/commands/prices-edit.ts`, `v1/src/commands/prices-show.ts`) and a shared module at `v1/src/prices/` (`cost.ts`, `load.ts`). The catalog's Commands section should capture this two-subcommand structure (`prices show` vs `prices edit` or equivalent) rather than treating `prices` as a single flat command.

### Confirmation: v2/spec/v1-behaviors.md does not exist yet

Verified: `v2/spec/v1-behaviors.md` is absent. Subspec 00 correctly creates it from scratch. The `v2/spec/` directory exists (contains only `wip-intents/`), so no directory creation is needed.

## Refine turn 3

### Remaining source files not yet listed

Source inspection found additional files with user-observable behavior that belong in the subspecs' reading lists:

**00-skeleton-and-commands** should also read:
- `v1/src/repo-url.ts` — URL normalization for `--repo` flag; collapses HTTPS, SSH, scp-like SSH, and bare `owner/repo` slugs to a canonical `host/owner/repo` form. Observable: a `--repo` value that doesn't produce at least three path segments after normalization is silently treated as unresolvable. Backs the Config and project resolution section.

**04-side-effects-completion** should also read:
- `v1/src/log-server-preflight.ts` — gates both `run` and `plan` on log server reachability before any agent work begins. Default URL is `http://127.0.0.1:4310/logs`. Failure produces a specific two-line stderr message (`jarvis: log server unreachable at <url>. Start it with \`jarvis log-server\` or update config.`) and exits 1. Observable: neither `run` nor `plan` will spawn an agent unless the log server is up.
- `v1/src/mode-entry.ts` — shared entry point that sequences repo resolution then log server preflight for both `run` and `plan`; no additional behaviors beyond what `repo.ts` and `log-server-preflight.ts` expose individually.

**01-agents-and-quota** should also read:
- `v1/src/agents/spawn.ts` — shared process lifecycle for all CLI agents. Observable behaviors: (1) On abort/Ctrl-C, sends SIGTERM to the agent process group, then SIGKILL after a 2000 ms grace period (configurable via `abortKillGraceMs`). (2) Process group kill uses `process.kill(-pgid, signal)` because agents are spawned with `detached: true`; this means child processes of the agent are also killed. (3) If abort happens before the process group settles, the AgentResult is `{ kind: "error", stderr: "aborted: <reason>" }`.
- `v1/src/agents/factory.ts` — simple dispatch to adapter constructors; no distinct user-observable behaviors beyond what each adapter exposes.

### Behavioral clarifications from cli.ts source

Two command-level asymmetries the catalog's Commands section should capture explicitly:

1. **`review-feedback` requires `<worktree-name>`** — unlike `triage`, where the worktree name is optional, `review-feedback` exits 1 with a usage error if `<worktree-name>` is omitted. The USAGE string marks it as required.

2. **`plan` flags** — the full flag set from the USAGE string: `--refine-turns <n>`, `--review-passes <n>`, `--repo <name|path|url>`, `--cwd <dir>`, `--resume` (expects `spec/<…>/index.md`), `--resume-draft` (expects `spec/<…>/intent.md`). Subspec 03 should catalog all six, noting the distinction between `--resume` (resumes a review pass) and `--resume-draft` (resumes from the intent/draft phase).

### Decomposition confirmed complete

No additional subspecs are needed. The six-subspec plan (00–05) covers every identified behavior area, the source file lists are now complete, and the assembly strategy (00 creates skeleton; 01–04 fill assigned sections; 05 verifies and adds maintenance) is sound. The intent is ready to draft.

