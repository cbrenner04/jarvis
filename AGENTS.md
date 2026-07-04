# AGENTS.md

Conventions for working in this repo — humans and coding agents alike. **BE TERSE** everywhere (specs, intents, commits, comments, PRs): verbosity costs review effort and money.

## What this repo is

`jarvis` is a minimal coding-agent harness driving an underlying agent CLI (`claude`, `codex`, `cursor`, …). Two modes: **patch** (`jarvis run`) — the "ralph loop" that sends one-shot prompts iterating on a target-repo spec until it's complete, killed (Ctrl-C), or all agents hit quota; **plan** (`jarvis plan`) — drafts a new spec collaboratively in a dedicated worktree. See [v1/docs/run-loop.md](v1/docs/run-loop.md) and [v1/docs/plan-mode.md](v1/docs/plan-mode.md).

Work here is work on the harness itself. Layout:

- root — shared glue, config, public docs, version-agnostic `scripts/` and `data/` (global `prices.json`)
- `shared/` — version-agnostic runtime code consumed by both `v1` and `v2`; `shared/**` must not import from `v1/**` or `v2/**`
- `v1/` — current shipping implementation (src, test, spec, docs)
- `v2/` — planning materials; future implementation lands under `v2/src`, with tests co-located next to the source files they cover

## Core decisions

- **Stack**: TypeScript on Bun, strict typing (`strict`, `noUncheckedIndexedAccess`).
- **Distribution**: personal use — clone and symlink the binary onto `PATH`. No npm publish. **Single operator**: the repo owner is the only user — "every user" means one person, so don't design for multi-user config, onboarding, or required-by-default setup.
- **Config**: `~/.jarvis/config.json`, auto-bootstrapped each run; edit via `jarvis config`. Holds a project registry: `jarvis init` records a target repo's root; `jarvis run <spec>` resolves cwd by matching the spec path against it. See [v1/docs/config.md](v1/docs/config.md).
- **Agent fallback order**: `claude → codex → cursor`, configurable. See [v1/docs/agents.md](v1/docs/agents.md).
- **Spec format** (target repos): Markdown with `- [ ]` task lists. Complete = zero unchecked items.
- **Quota detection**: per-agent stderr/exit-code heuristics — [v1/docs/quota-signals.md](v1/docs/quota-signals.md).
- **Operator runbook**: Reference for session patterns, sandbox blindness, and recovery workflows — [v1/docs/operator-runbook.md](v1/docs/operator-runbook.md).

Each iteration the agent is told to inspect the target repo for guidance, read the spec, follow the patch-mode rules in `v1/src/modes/patch/rules.md` (injected inline), and complete the single most important unchecked task.

## Specs in this repo

**Route by target:** v1 work (seeds and committed specs) lives under `v1/spec/`; genuine v2 planning under `v2/spec/`; a spec touching both surfaces routes to `v1/spec` (shipping surface wins). The jarvis project default `plan.targetDir` is `v1/spec` — v2 planning is authored with explicit `--target-dir v2/spec` override (both `jarvis plan` and `jarvis intent`). Note: this default takes effect only after the operator flips the live `~/.jarvis/config.json` from `v2/spec` to `v1/spec`.

Long-lived v2 reference docs live in `v2/docs/`. Multi-file specs go in `<targetDir>/<UTC-timestamp>-<name>/` with an `index.md`. The index is the routing file: a checklist of subspec pointers, each checked when done. Each subspec is **atomic, independently testable**, and carries a **Documentation updates** section (docs are part of the work). Create/resume with `jarvis1 plan` / `jarvis1 plan --resume <index.md>` from any directory. Full conventions: [v1/docs/spec-guidance.md](v1/docs/spec-guidance.md).

## Working rules for agents

- Do work on a git worktree, not the primary checkout.
- Temp/scratch/working files go in repo-local `.scratch/` (gitignored) — not system `/tmp` or scattered tmp dirs.
- A spec must exist before any change. None yet? Create one first ([spec-guidance.md](v1/docs/spec-guidance.md)), merge it to `main` via PR, *then* start a separate implementation run. Specs already on disk get run through `jarvis`, not implemented by hand.
- Read `index.md` to pick the next unchecked subspec, then read that subspec before editing.
- Run `bun run typecheck` (unscoped) before ticking the acceptance criteria they cover, plus the test script(s) matching the surface(s) touched since the branch/merge-base (`git diff <merge-base>...`), same rule as `scripts/ci-test-scope.ts`: `v1/**` → `test:v1`; `v2/**` → `test:v2` + `test:integration:v2`; `shared/**` → all three; root tooling touched, or surface undetermined → full `bun run test`. Do not run `bun run ready` — Jarvis runs that harness gate automatically when the spec completes and flips the draft PR to ready.
- Tick `- [ ]` items only in the subspec's `## Acceptance criteria` section, only once satisfied, never speculatively. Other checklist sections are informational; Jarvis ignores them.
- **Do not** edit `index.md` or run `git commit` — Jarvis owns the index checkbox and all commits (`git add -A` would absorb manual ones unexpectedly).
- Blocked or ambiguous? Append a `## Blocker` to the subspec and stop, rather than guess.
- Keep changes minimal and within the active subspec's scope — no speculative refactors, no unauthorized harness changes.
- **Concise updates.** When reporting back, report only what's needed: the command run and the landed result, plus a concise session summary after each landed intent. No running commentary. See [v1/docs/operator-runbook.md#operator-feedback-cadence](v1/docs/operator-runbook.md#operator-feedback-cadence).
- **No planning labels in code.** Phase/milestone/slice names are sequencing artifacts — never bake them into identifiers, filenames, or public API. A spec saying "Phase 1 state store" names *the state store*; call it that.
- **Log server is always running** on the operator machine (`jarvis1 log-server` on `127.0.0.1:4310`, started and owned outside agent sessions). **Never** start, stop, restart, or kill port-4310 processes from an agent session — a second instance fights for the port or displaces the operator's long-lived server. `plan`/`run` preflight `log server unreachable` is almost always sandbox blindness; see [operator-runbook.md § Log server](v1/docs/operator-runbook.md#log-server).
- **Log server is always running** on the operator machine (`jarvis1 log-server` on `127.0.0.1:4310`, started and owned outside agent sessions). **Never** start, stop, restart, or kill port-4310 processes from an agent session — a second instance fights for the port or displaces the operator's long-lived server. `plan`/`run` preflight `log server unreachable` is almost always sandbox blindness; see [operator-runbook.md § Log server](v1/docs/operator-runbook.md#log-server).

## PR attribution

Jarvis stamps every commit with a `Jarvis-Agent: <label>` trailer and renders an attribution footer onto draft-PR bodies from them — automatic, not requested of the agent. Mechanics (footer format, plan-mode meta-commit collapsing): [v1/docs/worktrees-and-commits.md](v1/docs/worktrees-and-commits.md).

## Harness friction?

If you hit friction using Jarvis as a coding agent in another repo — a missing feature, a workflow gap, a confusing error — [surface it here](https://github.com/cbrenner04/jarvis/issues/new/choose). This is the official channel for harness suggestions.
