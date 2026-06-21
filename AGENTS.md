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

V1 specs live in `v1/spec/`; v2 specs and work-seed intents in `v2/spec/` (intents under `v2/spec/wip-intents/`). Long-lived v2 reference docs live in `v2/docs/`. The `plan.targetDir = "v1/spec"` config entry routes new plan-mode specs there.

Multi-file specs go in `v1/spec/<UTC-timestamp>-<name>/` with an `index.md`. The index is the routing file: a checklist of subspec pointers, each checked when done. Each subspec is **atomic, independently testable**, and carries a **Documentation updates** section (docs are part of the work). Create/resume with `jarvis1 plan` / `jarvis1 plan --resume <index.md>` from any directory. Full conventions: [v1/docs/spec-guidance.md](v1/docs/spec-guidance.md).

## Working rules for agents

- Do work on a git worktree, not the primary checkout.
- A spec must exist before any change. None yet? Create one first ([spec-guidance.md](v1/docs/spec-guidance.md)), merge it to `main` via PR, *then* start a separate implementation run. Specs already on disk get run through `jarvis`, not implemented by hand.
- Read `index.md` to pick the next unchecked subspec, then read that subspec before editing.
- Run `bun run typecheck` and `bun run test` before ticking the acceptance criteria they cover. Do not run `bun run ready` — Jarvis runs that harness gate automatically when the spec completes and flips the draft PR to ready.
- Tick `- [ ]` items only in the subspec's `## Acceptance criteria` section, only once satisfied, never speculatively. Other checklist sections are informational; Jarvis ignores them.
- **Do not** edit `index.md` or run `git commit` — Jarvis owns the index checkbox and all commits (`git add -A` would absorb manual ones unexpectedly).
- Blocked or ambiguous? Append a `## Blocker` to the subspec and stop, rather than guess.
- Keep changes minimal and within the active subspec's scope — no speculative refactors, no unauthorized harness changes.
- **No planning labels in code.** Phase/milestone/slice names are sequencing artifacts — never bake them into identifiers, filenames, or public API. A spec saying "Phase 1 state store" names *the state store*; call it that.

## PR attribution

Jarvis stamps every commit with a `Jarvis-Agent: <label>` trailer and renders an attribution footer onto draft-PR bodies from them — automatic, not requested of the agent. Mechanics (footer format, plan-mode meta-commit collapsing): [v1/docs/worktrees-and-commits.md](v1/docs/worktrees-and-commits.md).
